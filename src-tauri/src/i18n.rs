use serde_json::Value;
use std::collections::BTreeMap;
#[cfg(test)]
use std::collections::BTreeSet;
use std::sync::OnceLock;

pub const DEFAULT_LOCALE: &str = "en-US";

#[allow(dead_code)]
pub const SHIPPED_LOCALES: [&str; 5] = ["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"];

const RAW_ZH_CN: &str = include_str!("../../locales/zh-CN.json");
const RAW_ZH_TW: &str = include_str!("../../locales/zh-TW.json");
const RAW_EN_US: &str = include_str!("../../locales/en-US.json");
const RAW_JA_JP: &str = include_str!("../../locales/ja-JP.json");
const RAW_KO_KR: &str = include_str!("../../locales/ko-KR.json");

struct Catalogs {
    maps: BTreeMap<&'static str, BTreeMap<String, String>>,
}

fn flatten_json(prefix: &str, val: &Value, out: &mut BTreeMap<String, String>) {
    match val {
        Value::Object(map) => {
            for (k, v) in map {
                if k == "_version" {
                    continue;
                }
                let next = if prefix.is_empty() {
                    k.clone()
                } else {
                    format!("{prefix}.{k}")
                };
                flatten_json(&next, v, out);
            }
        }
        Value::String(s) => {
            out.insert(prefix.to_string(), s.clone());
        }
        _ => {}
    }
}

fn parse_catalog(raw: &str) -> BTreeMap<String, String> {
    let val: Value = serde_json::from_str(raw).expect("embedded locale JSON must be valid");
    let mut map = BTreeMap::new();
    flatten_json("", &val, &mut map);
    map
}

fn catalogs() -> &'static Catalogs {
    static INSTANCE: OnceLock<Catalogs> = OnceLock::new();
    INSTANCE.get_or_init(|| {
        let mut maps = BTreeMap::new();
        maps.insert("zh-CN", parse_catalog(RAW_ZH_CN));
        maps.insert("zh-TW", parse_catalog(RAW_ZH_TW));
        maps.insert("en-US", parse_catalog(RAW_EN_US));
        maps.insert("ja-JP", parse_catalog(RAW_JA_JP));
        maps.insert("ko-KR", parse_catalog(RAW_KO_KR));
        Catalogs { maps }
    })
}

fn is_simplified_chinese(normalized: &str) -> bool {
    !normalized
        .split('-')
        .any(|sub| matches!(sub, "hant" | "tw" | "hk" | "mo"))
}

/// Resolve any BCP-47 / POSIX locale tag onto one of KuroCat's 5 shipped catalogs.
pub fn resolve_locale_tag(raw: &str) -> &'static str {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return DEFAULT_LOCALE;
    }
    // Strip POSIX encoding/modifier suffixes like `.UTF-8` or `@euro`
    let base = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .split('@')
        .next()
        .unwrap_or(trimmed);
    let normalized = base.replace('_', "-").to_ascii_lowercase();
    let primary = normalized.split('-').next().unwrap_or("");
    match primary {
        "zh" => {
            if is_simplified_chinese(&normalized) {
                "zh-CN"
            } else {
                "zh-TW"
            }
        }
        "ja" => "ja-JP",
        "ko" => "ko-KR",
        "en" => "en-US",
        _ => DEFAULT_LOCALE,
    }
}

/// Detect the operating system UI language without adding any external crates.
pub fn detect_system_locale() -> &'static str {
    #[cfg(windows)]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn GetUserDefaultLocaleName(lp_locale_name: *mut u16, cch_locale_name: i32) -> i32;
        }
        let mut buf = [0u16; 85];
        let len = unsafe { GetUserDefaultLocaleName(buf.as_mut_ptr(), buf.len() as i32) };
        if len > 1 {
            let tag = String::from_utf16_lossy(&buf[..(len as usize - 1)]);
            return resolve_locale_tag(&tag);
        }
    }

    for env_key in ["LC_ALL", "LC_MESSAGES", "LANG"] {
        if let Ok(val) = std::env::var(env_key) {
            if !val.trim().is_empty() && !val.eq_ignore_ascii_case("C") && !val.eq_ignore_ascii_case("POSIX") {
                return resolve_locale_tag(&val);
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("/usr/bin/defaults")
            .args(["read", "-g", "AppleLocale"])
            .output()
        {
            if out.status.success() {
                let tag = String::from_utf8_lossy(&out.stdout);
                if !tag.trim().is_empty() {
                    return resolve_locale_tag(&tag);
                }
            }
        }
    }

    DEFAULT_LOCALE
}

/// Normalize the persisted user language setting (`"auto"` or one of `SHIPPED_LOCALES`).
pub fn normalize_language_setting(raw: &str) -> String {
    let clean = raw.trim();
    if clean.is_empty() || clean.eq_ignore_ascii_case("auto") {
        return "auto".to_string();
    }
    resolve_locale_tag(clean).to_string()
}

/// Resolve `"auto"` or an explicit setting into an effective shipped locale code.
pub fn effective_locale(setting: &str) -> &'static str {
    let clean = setting.trim();
    if clean.is_empty() || clean.eq_ignore_ascii_case("auto") {
        detect_system_locale()
    } else {
        resolve_locale_tag(clean)
    }
}

pub fn t(locale: &str, key: &str) -> String {
    let eff = effective_locale(locale);
    let cats = catalogs();
    if let Some(val) = cats.maps.get(eff).and_then(|m| m.get(key)) {
        return val.clone();
    }
    if let Some(val) = cats.maps.get(DEFAULT_LOCALE).and_then(|m| m.get(key)) {
        return val.clone();
    }
    key.to_string()
}

pub fn tf(locale: &str, key: &str, vars: &[(&str, String)]) -> String {
    let mut text = t(locale, key);
    for (name, value) in vars {
        text = text.replace(&format!("{{{name}}}"), value);
    }
    text
}

pub fn platform_click_through_key() -> &'static str {
    if cfg!(target_os = "macos") {
        "tray.click_through_macos"
    } else {
        "tray.click_through_windows"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extract_placeholders(s: &str) -> BTreeSet<String> {
        let mut set = BTreeSet::new();
        let mut chars = s.chars().peekable();
        while let Some(c) = chars.next() {
            if c == '{' {
                let mut name = String::new();
                while let Some(&nc) = chars.peek() {
                    chars.next();
                    if nc == '}' {
                        break;
                    }
                    name.push(nc);
                }
                if !name.is_empty() {
                    set.insert(name);
                }
            }
        }
        set
    }

    #[test]
    fn resolves_bcp47_and_zh_scripts_accurately() {
        assert_eq!(resolve_locale_tag("zh-CN"), "zh-CN");
        assert_eq!(resolve_locale_tag("zh_Hans_SG.UTF-8"), "zh-CN");
        assert_eq!(resolve_locale_tag("zh-TW"), "zh-TW");
        assert_eq!(resolve_locale_tag("zh-HK"), "zh-TW");
        assert_eq!(resolve_locale_tag("zh-Hant-MO"), "zh-TW");
        assert_eq!(resolve_locale_tag("ja_JP.UTF-8"), "ja-JP");
        assert_eq!(resolve_locale_tag("ko"), "ko-KR");
        assert_eq!(resolve_locale_tag("en-GB"), "en-US");
        assert_eq!(resolve_locale_tag("de-DE"), "en-US");
    }

    #[test]
    fn all_five_locales_have_exact_key_and_placeholder_parity() {
        let cats = catalogs();
        let base = cats.maps.get("zh-CN").expect("zh-CN catalog missing");
        let base_keys: BTreeSet<&String> = base.keys().collect();
        assert!(base_keys.len() >= 80, "expected full desktop catalog");

        for loc in SHIPPED_LOCALES {
            let map = cats.maps.get(loc).expect("shipped locale missing");
            let keys: BTreeSet<&String> = map.keys().collect();
            let missing: Vec<_> = base_keys.difference(&keys).collect();
            let extra: Vec<_> = keys.difference(&base_keys).collect();
            assert!(missing.is_empty(), "locale {loc} missing keys: {missing:?}");
            assert!(extra.is_empty(), "locale {loc} has extra keys: {extra:?}");

            for (k, base_val) in base {
                let val = &map[k];
                assert!(!val.trim().is_empty(), "locale {loc} key {k} is empty");
                assert_eq!(
                    extract_placeholders(base_val),
                    extract_placeholders(val),
                    "placeholder mismatch in {loc} key {k}"
                );
            }
        }
    }
}
