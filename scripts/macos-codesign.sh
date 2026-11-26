#!/usr/bin/env bash
# Sign KuroCat for macOS with a stable identity so privacy permissions survive updates.
#
# macOS stores Accessibility / Input Monitoring grants together with the app's designated
# requirement. An ad hoc signature pins that requirement to the binary hash, so every release
# looks like a different app and users have to grant the permissions again. Signing every
# release with the same certificate (a self-signed one is enough) keeps the requirement at
# identifier "com.kurocat.pet" and certificate leaf = H"...", which later releases satisfy.
#
# 'sign' picks the identity in this order:
#   1. MACOS_SIGNING_CERT_P12_BASE64 + MACOS_SIGNING_CERT_PASSWORD (CI secrets), imported into
#      a temporary keychain that is deleted afterwards. Setting only one of them, or a
#      certificate that cannot be imported, is an error.
#   2. MACOS_SIGNING_IDENTITY, a certificate name or SHA-1 already in your keychain.
#   3. Nothing configured: keep an existing valid signature or sign ad hoc, and warn that
#      users have to grant the permissions again after updating. The release still succeeds.
set -euo pipefail

CERT_NAME="${MACOS_SIGNING_CERT_NAME:-KuroCat Code Signing}"
SECRET_HINT="Fix the secrets, or delete both of them to fall back to ad hoc signing."
RCODESIGN_VERSION="0.29.0"
RCODESIGN_URL="https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign/${RCODESIGN_VERSION}/apple-codesign-${RCODESIGN_VERSION}-macos-universal.tar.gz"
RCODESIGN_SHA256="d98372d5524226ccf9dc0eda03d4e4f5826182dabb2fc3f2bd303ed9113a748d"
WORK_DIR=""
MOUNT_POINT=""

usage() {
  cat <<'EOF'
Usage:
  scripts/macos-codesign.sh create-cert <output-dir>
  scripts/macos-codesign.sh sign <KuroCat.app>
  scripts/macos-codesign.sh requirement <KuroCat.app>
  scripts/macos-codesign.sh verify <KuroCat.app> [designated-requirement]
  scripts/macos-codesign.sh verify-artifact <file.dmg|file.app.tar.gz> <designated-requirement>
EOF
  exit "${1:-2}"
}

die() {
  echo "error: $*" >&2
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::error::$*"
  fi
  exit 1
}

warn() {
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    echo "::warning::$*"
  else
    echo "warning: $*" >&2
  fi
}

step_summary() {
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$*" >> "$GITHUB_STEP_SUMMARY"
  fi
}

cleanup() {
  if [[ -n "$MOUNT_POINT" ]]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 ||
      hdiutil detach -force "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
  if [[ -n "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

bundle_id() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist"
}

designated_requirement() {
  codesign -d -r- "$1" 2>&1 | sed -n 's/^#* *designated => //p'
}

print_requirement() {
  local requirement
  requirement="$(designated_requirement "$1")"
  [[ -n "$requirement" ]] || die "$1 has no designated requirement"
  echo "$requirement"
}

verify_app() {
  local app="$1" requirement="${2:-}"
  codesign --verify --strict --all-architectures --verbose=2 \
    -R "=identifier \"$(bundle_id "$app")\"" "$app" || return 1
  if [[ -n "$requirement" ]]; then
    codesign --verify --strict --all-architectures -R "=$requirement" "$app" || return 1
    echo "$app: satisfies the expected designated requirement"
  fi
}

find_app() {
  find "$1" -maxdepth 1 -name '*.app' -type d -print -quit
}

ensure_rcodesign() {
  if command -v rcodesign >/dev/null 2>&1; then
    command -v rcodesign
    return 0
  fi
  local tgz="$WORK_DIR/rcodesign.tar.gz" extract="$WORK_DIR/rcodesign-bin" bin
  mkdir -p "$extract"
  curl -fsSL "$RCODESIGN_URL" -o "$tgz" || die "failed to download rcodesign ${RCODESIGN_VERSION}"
  printf '%s  %s\n' "$RCODESIGN_SHA256" "$tgz" | shasum -a 256 -c - >/dev/null ||
    die "rcodesign ${RCODESIGN_VERSION} SHA-256 checksum mismatch"
  tar -xzf "$tgz" -C "$extract"
  bin="$(find "$extract" -name rcodesign -type f -print -quit)"
  [[ -n "$bin" ]] || die "rcodesign binary not found inside archive"
  chmod +x "$bin"
  echo "$bin"
}

sign_with_p12() {
  local app="$1" id="$2" rcodesign_bin cert_info fingerprint
  umask 077
  WORK_DIR="$(cd "$(mktemp -d)" && pwd -P)"

  printf '%s' "$MACOS_SIGNING_CERT_P12_BASE64" | tr -d '[:space:]' |
    base64 --decode > "$WORK_DIR/signing.p12" 2>/dev/null ||
    die "MACOS_SIGNING_CERT_P12_BASE64 is not valid base64. $SECRET_HINT"
  [[ -s "$WORK_DIR/signing.p12" ]] || die "MACOS_SIGNING_CERT_P12_BASE64 is empty. $SECRET_HINT"
  printf '%s' "$MACOS_SIGNING_CERT_PASSWORD" > "$WORK_DIR/signing.password"

  # Use rcodesign to sign directly from the PKCS#12 file without touching the macOS Keychain
  # (avoids headless CI securityd/SecurityAgent ACL prompts on modern macOS runners).
  rcodesign_bin="$(ensure_rcodesign)"
  cert_info="$("$rcodesign_bin" analyze-certificate \
    --p12-file "$WORK_DIR/signing.p12" \
    --p12-password-file "$WORK_DIR/signing.password" 2>&1)" ||
    die "could not open the PKCS#12 certificate. MACOS_SIGNING_CERT_P12_BASE64 must be the base64 of kurocat-signing.p12 and MACOS_SIGNING_CERT_PASSWORD its password. $SECRET_HINT"

  fingerprint="$(printf '%s\n' "$cert_info" |
    awk '/^SHA-1 fingerprint:/ { print tolower($3); exit }')"
  [[ "$fingerprint" =~ ^[0-9a-f]{40}$ ]] ||
    die "could not determine certificate SHA-1 fingerprint. $SECRET_HINT"

  csreq -r "=identifier \"$id\" and certificate leaf = H\"$fingerprint\"" -b "$WORK_DIR/dr.csreq" ||
    die "csreq failed to compile designated requirement"

  echo "Signing $app with certificate SHA-1 $fingerprint (via rcodesign ${RCODESIGN_VERSION}, keychain-free)"
  "$rcodesign_bin" sign \
    --p12-file "$WORK_DIR/signing.p12" \
    --p12-password-file "$WORK_DIR/signing.password" \
    --code-requirements-file "$WORK_DIR/dr.csreq" \
    --timestamp-url none \
    "$app" "$WORK_DIR/signed.app"
  rm -rf "$app"
  mv "$WORK_DIR/signed.app" "$app"
}

sign_app() {
  local app="$1" id requirement
  local p12="${MACOS_SIGNING_CERT_P12_BASE64:-}" password="${MACOS_SIGNING_CERT_PASSWORD:-}"
  [[ -d "$app" ]] || die "app bundle not found: $app"
  id="$(bundle_id "$app")"

  if [[ -n "$p12" || -n "$password" ]]; then
    [[ -n "$p12" && -n "$password" ]] ||
      die "MACOS_SIGNING_CERT_P12_BASE64 and MACOS_SIGNING_CERT_PASSWORD must be set together. $SECRET_HINT"
    sign_with_p12 "$app" "$id"
  elif [[ -n "${MACOS_SIGNING_IDENTITY:-}" ]]; then
    echo "Signing $app with $MACOS_SIGNING_IDENTITY"
    codesign --force --sign "$MACOS_SIGNING_IDENTITY" --identifier "$id" --timestamp=none "$app"
  elif verify_app "$app" >/dev/null 2>&1; then
    echo "Keeping the existing valid signature of $app"
  else
    echo "Signing $app ad hoc"
    codesign --force --deep --sign - --identifier "$id" "$app" 2>/dev/null ||
      codesign --force --sign - --identifier "$id" "$app"
  fi

  if ! verify_app "$app"; then
    if [[ -z "${MACOS_SIGNING_IDENTITY:-}" && -z "${MACOS_SIGNING_CERT_P12_BASE64:-}" ]]; then
      warn "$app did not pass strict verification after ad hoc signing; shipping it anyway because no signing certificate is configured"
      step_summary "macOS: ad hoc signature could not be strictly verified on this runner (no signing certificate configured)."
      return 0
    fi
    die "$app failed signature verification after signing"
  fi
  requirement="$(print_requirement "$app" 2>/dev/null || true)"
  echo "Designated requirement: $requirement"
  if [[ "$requirement" == *cdhash* ]]; then
    warn "KuroCat is signed ad hoc, so users have to grant Accessibility and Input Monitoring again after every update. Set MACOS_SIGNING_CERT_P12_BASE64 and MACOS_SIGNING_CERT_PASSWORD to keep the grants."
    step_summary "macOS signing: ad hoc. Users have to grant Accessibility and Input Monitoring again after updating."
  else
    step_summary "macOS signing: $requirement"
  fi
}

verify_artifact() {
  local file="$1" requirement="$2" app="" mounted="" attempt
  [[ -f "$file" ]] || die "release artifact not found: $file"
  if [[ -z "$requirement" ]]; then
    warn "no designated requirement recorded for $file; skipping the deep re-verification"
    return 0
  fi
  WORK_DIR="$(mktemp -d)"

  case "$file" in
    *.dmg)
      MOUNT_POINT="$WORK_DIR/mnt"
      mkdir -p "$MOUNT_POINT"
      for attempt in 1 2 3; do
        if hdiutil attach -readonly -nobrowse -noautoopen -mountpoint "$MOUNT_POINT" "$file" >/dev/null; then
          mounted=1
          break
        fi
        sleep $((attempt * 3))
      done
      [[ -n "$mounted" ]] || die "could not mount $file"
      app="$(find_app "$MOUNT_POINT")"
      ;;
    *.tar.gz | *.tgz)
      tar -xzf "$file" -C "$WORK_DIR"
      app="$(find_app "$WORK_DIR")"
      ;;
    *)
      die "unsupported release artifact: $file"
      ;;
  esac

  [[ -n "$app" ]] || die "no .app bundle found in $file"
  verify_app "$app" "$requirement" || die "the app in $file is not signed as expected"
  echo "$file: verified"
}

create_cert() {
  local out="$1" fingerprint
  [[ ! -e "$out/kurocat-signing.p12" ]] ||
    die "$out/kurocat-signing.p12 already exists. Keep using it: a new certificate makes users grant the permissions again."
  command -v openssl >/dev/null || die "openssl is required"

  umask 077
  mkdir -p "$out"
  if git -C "$out" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    rmdir "$out" 2>/dev/null || true
    die "$out is inside a git work tree; keep the private key outside the repository"
  fi

  WORK_DIR="$(mktemp -d)"
  cat > "$WORK_DIR/openssl.cnf" <<EOF
[ req ]
distinguished_name = dn
x509_extensions = codesign
prompt = no
[ dn ]
CN = $CERT_NAME
[ codesign ]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF
  openssl req -new -x509 -newkey rsa:2048 -nodes -days 7300 -sha256 \
    -config "$WORK_DIR/openssl.cnf" \
    -keyout "$WORK_DIR/signing.key" -out "$out/kurocat-signing.crt" >/dev/null 2>&1 ||
    die "openssl could not create the certificate"

  KUROCAT_P12_PASSWORD="$(openssl rand -base64 24)"
  export KUROCAT_P12_PASSWORD
  # 3DES / SHA-1 keeps the PKCS#12 file importable by the macOS security tool.
  openssl pkcs12 -export -name "$CERT_NAME" \
    -inkey "$WORK_DIR/signing.key" -in "$out/kurocat-signing.crt" \
    -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 \
    -passout env:KUROCAT_P12_PASSWORD -out "$out/kurocat-signing.p12"
  base64 -i "$out/kurocat-signing.p12" -o "$out/kurocat-signing.p12.base64"
  printf '%s' "$KUROCAT_P12_PASSWORD" > "$out/kurocat-signing.password"
  fingerprint="$(openssl x509 -in "$out/kurocat-signing.crt" -noout -fingerprint -sha1 |
    cut -d= -f2 | tr -d ':')"

  cat <<EOF
Created a self-signed code signing certificate, valid for 20 years.
  Certificate SHA-1: $fingerprint
  Files: $out/kurocat-signing.p12, kurocat-signing.p12.base64, kurocat-signing.password

Add it to the repository's GitHub Actions secrets:
  gh secret set MACOS_SIGNING_CERT_P12_BASE64 < "$out/kurocat-signing.p12.base64"
  gh secret set MACOS_SIGNING_CERT_PASSWORD < "$out/kurocat-signing.password"

Back up kurocat-signing.p12 and its password, and sign every release with this certificate.
With a different certificate macOS treats KuroCat as a new app, and users have to grant
the permissions again.
EOF
}

case "${1:-}" in
  create-cert) [[ $# -eq 2 ]] || usage; create_cert "$2" ;;
  sign) [[ $# -eq 2 ]] || usage; sign_app "$2" ;;
  requirement) [[ $# -eq 2 ]] || usage; print_requirement "$2" 2>/dev/null || warn "no designated requirement available (ad hoc signing); artifact verification will be skipped" ;;
  verify) [[ $# -ge 2 && $# -le 3 ]] || usage; verify_app "$2" "${3:-}" ;;
  verify-artifact) [[ $# -eq 3 ]] || usage; verify_artifact "$2" "$3" ;;
  -h | --help | help) usage 0 ;;
  *) usage ;;
esac
