//! Lightweight, anti-cheat-safe automatic game detector for KuroCat gaming headphones.
//!
//! - Read-only foreground window/executable metadata query ONLY (never injects DLLs, never opens
//!   game memory, uses `PROCESS_QUERY_LIMITED_INFORMATION` on Windows).
//! - Runs only when `headphone_mode == "auto"` and app is not paused (~1.8s poll interval, ~0% CPU).
//! - Includes an ~7s Alt-Tab grace period so briefly switching to WeChat/browser doesn't flicker
//!   the headphones off and back on.

use crate::config::AppSettings;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

static GAME_ACTIVE: AtomicBool = AtomicBool::new(false);

pub fn is_game_active() -> bool {
    GAME_ACTIVE.load(Ordering::Relaxed)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameActivePayload {
    pub active: bool,
    pub game_name: Option<String>,
    pub needs_admin: bool,
}

/// Kernel anti-cheat titles where we recommend "Pause & Hide (Anti-Cheat Safe Mode)"
/// rather than prompting the user to elevate KuroCat as Administrator.
const KERNEL_ANTICHEAT_EXES: &[&str] = &[
    "valorant-win64-shipping.exe",
    "deltaforceclient-win64-shipping.exe",
    "df_client.exe",
    "league of legends.exe",
];

/// Pure, unit-testable policy for whether to emit the non-intrusive "elevate as admin" hint.
pub fn should_suggest_admin_elevation(
    exe_path: &str,
    game_detected: bool,
    target_elevated: bool,
    self_elevated: bool,
) -> bool {
    if !game_detected || !target_elevated || self_elevated {
        return false;
    }
    let path_lower = exe_path.trim().replace('/', "\\").to_ascii_lowercase();
    let exe_name = path_lower.rsplit('\\').next().unwrap_or("");
    if exe_name.is_empty() || KERNEL_ANTICHEAT_EXES.contains(&exe_name) {
        return false;
    }
    true
}

/// Known non-game apps (browsers, video players, office, chat, IDEs, streaming tools) that must
/// NEVER trigger gaming headphones even when playing fullscreen video or running hardware acceleration.
const EXCLUDED_EXES: &[&str] = &[
    "kurocat.exe",
    "kuro-cat-pet.exe",
    "explorer.exe",
    "searchhost.exe",
    "shellexperiencehost.exe",
    "startmenuexperiencehost.exe",
    "lockapp.exe",
    "applicationframehost.exe",
    "dwm.exe",
    "taskmgr.exe",
    // Browsers
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "brave.exe",
    "opera.exe",
    "vivaldi.exe",
    "arc.exe",
    "360chrome.exe",
    "360chromex.exe",
    "qqbrowser.exe",
    "sogouexplorer.exe",
    "quark.exe",
    // Media & video players
    "vlc.exe",
    "potplayermini64.exe",
    "potplayermini.exe",
    "mpv.exe",
    "mpc-hc64.exe",
    "mpc-be64.exe",
    "wmplayer.exe",
    "bilibili.exe",
    "douyin.exe",
    "qiyi.exe",
    "iqiyi.exe",
    "youkumedia.exe",
    "qqlive.exe",
    "cloudmusic.exe",
    "qqmusic.exe",
    "spotify.exe",
    // Office / productivity / chat / streaming
    "powerpnt.exe",
    "winword.exe",
    "excel.exe",
    "wps.exe",
    "wpp.exe",
    "et.exe",
    "acrobat.exe",
    "code.exe",
    "cursor.exe",
    "devenv.exe",
    "idea64.exe",
    "wechat.exe",
    "weixin.exe",
    "qq.exe",
    "tim.exe",
    "dingtalk.exe",
    "feishu.exe",
    "lark.exe",
    "slack.exe",
    "discord.exe",
    "zoom.exe",
    "wemeetapp.exe",
    "obs64.exe",
    "obs32.exe",
    "mstsc.exe",
    "mstscax.exe",
    "windowsterminal.exe",
    "cmd.exe",
    "powershell.exe",
    "pwsh.exe",
    // Game store launchers themselves (should wait until actual game launches)
    "steam.exe",
    "steamwebhelper.exe",
    "epicgameslauncher.exe",
    "wegame.exe",
    "tgp_daemon.exe",
    "riotclientservices.exe",
    "riotclientux.exe",
    "battle.net.exe",
    "hyp.exe",
    "hoyoplay.exe",
    "launcher.exe",
    "upc.exe",
    "eadesktop.exe",
];

/// Popular PC games (MOBA, FPS, Battle Royale, Action/RPG, Gacha, Sandbox, Indie, Rhythm, Party).
const KNOWN_GAME_EXES: &[(&str, &str)] = &[
    // MOBA & Competitive FPS / Battle Royale
    ("league of legends.exe", "League of Legends"),
    ("valorant-win64-shipping.exe", "VALORANT"),
    ("cs2.exe", "Counter-Strike 2"),
    ("csgo.exe", "CS:GO"),
    ("dota2.exe", "Dota 2"),
    ("r5apex.exe", "Apex Legends"),
    ("r5apex_dx12.exe", "Apex Legends"),
    ("tslgame.exe", "PUBG"),
    ("overwatch.exe", "Overwatch"),
    ("narakabladepoint.exe", "Naraka: Bladepoint"),
    ("deltaforceclient-win64-shipping.exe", "Delta Force"),
    ("df_client.exe", "Delta Force"),
    ("crossfire.exe", "CrossFire"),
    ("crossfire_x64.exe", "CrossFire"),
    ("dnf.exe", "DNF"),
    ("rainbowsix.exe", "Rainbow Six Siege"),
    ("rainbowsix_vulkan.exe", "Rainbow Six Siege"),
    ("rainbowsix_be.exe", "Rainbow Six Siege"),
    ("fortniteclient-win64-shipping.exe", "Fortnite"),
    ("cod.exe", "Call of Duty"),
    ("bf2042.exe", "Battlefield 2042"),
    ("deadlock.exe", "Deadlock"),
    ("discovery.exe", "THE FINALS"),
    ("escapefromtarkov.exe", "Escape from Tarkov"),
    ("worldoftanks.exe", "World of Tanks"),
    ("aces.exe", "War Thunder"),
    ("marvel-win64-shipping.exe", "Marvel Rivals"),
    // RPG / Open World / Gacha / Action
    ("genshinimpact.exe", "Genshin Impact"),
    ("yuanshen.exe", "原神"),
    ("starrail.exe", "崩坏：星穹铁道"),
    ("zenlesszonezero.exe", "绝区零"),
    ("honkai3rd.exe", "崩坏3"),
    ("bh3.exe", "崩坏3"),
    ("client-win64-shipping.exe", "鸣潮"),
    ("b1-win64-shipping.exe", "黑神话：悟空"),
    ("eldenring.exe", "Elden Ring"),
    ("sekiro.exe", "Sekiro"),
    ("darksoulsiii.exe", "Dark Souls III"),
    ("cyberpunk2077.exe", "Cyberpunk 2077"),
    ("gta5.exe", "GTA V"),
    ("gta5_enhanced.exe", "GTA V"),
    ("rdr2.exe", "Red Dead Redemption 2"),
    ("witcher3.exe", "The Witcher 3"),
    ("bg3.exe", "Baldur's Gate 3"),
    ("bg3_dx11.exe", "Baldur's Gate 3"),
    ("monsterhunterwilds.exe", "Monster Hunter Wilds"),
    ("monsterhunterworld.exe", "Monster Hunter: World"),
    ("monsterhunterrise.exe", "Monster Hunter Rise"),
    ("palworld-win64-shipping.exe", "Palworld"),
    ("helldivers2.exe", "Helldivers 2"),
    ("wow.exe", "World of Warcraft"),
    ("wowclassic.exe", "WoW Classic"),
    ("ffxiv_dx11.exe", "Final Fantasy XIV"),
    ("diablo iv.exe", "Diablo IV"),
    ("pathofexile.exe", "Path of Exile"),
    ("pathofexile2.exe", "Path of Exile 2"),
    ("pathofexilesteam.exe", "Path of Exile"),
    ("lostark.exe", "Lost Ark"),
    ("jx3client.exe", "剑网3"),
    ("jx3clientx64.exe", "剑网3"),
    ("nsh.exe", "逆水寒"),
    ("hearthstone.exe", "Hearthstone"),
    ("nikke.exe", "NIKKE"),
    ("identityv.exe", "第五人格"),
    ("yys.exe", "阴阳师"),
    // Sandbox / Indie / Rhythm / Strategy / Party
    ("minecraft.windows.exe", "Minecraft"),
    ("robloxplayerbeta.exe", "Roblox"),
    ("osu!.exe", "osu!"),
    ("terraria.exe", "Terraria"),
    ("stardew valley.exe", "Stardew Valley"),
    ("hollow_knight.exe", "Hollow Knight"),
    ("celeste.exe", "Celeste"),
    ("hades.exe", "Hades"),
    ("hades2.exe", "Hades II"),
    ("balatro.exe", "Balatro"),
    ("among us.exe", "Among Us"),
    ("lethal company.exe", "Lethal Company"),
    ("partyanimals.exe", "Party Animals"),
    ("factorio.exe", "Factorio"),
    ("rimworldwin64.exe", "RimWorld"),
    ("civilizationvi.exe", "Civilization VI"),
    ("civilizationvii.exe", "Civilization VII"),
    ("eurotrucks2.exe", "Euro Truck Simulator 2"),
    ("forzahorizon5.exe", "Forza Horizon 5"),
    ("fc24.exe", "EA SPORTS FC 24"),
    ("fc25.exe", "EA SPORTS FC 25"),
    ("nba2k25.exe", "NBA 2K25"),
    ("splitfiction.exe", "Split Fiction"),
    ("ittakestwo.exe", "It Takes Two"),
    ("dontstarve_steam_x64.exe", "Don't Starve Together"),
    ("human.exe", "Human: Fall Flat"),
    ("fallguys_client_game.exe", "Fall Guys"),
    ("rocketleague.exe", "Rocket League"),
    ("deadbydaylight-win64-shipping.exe", "Dead by Daylight"),
    ("phasmophobia.exe", "Phasmophobia"),
    ("rustclient.exe", "Rust"),
    ("valheim.exe", "Valheim"),
    ("subnautica.exe", "Subnautica"),
    ("left4dead2.exe", "Left 4 Dead 2"),
    ("hl2.exe", "Half-Life 2"),
    ("tf_win64.exe", "Team Fortress 2"),
    ("destiny2.exe", "Destiny 2"),
    ("warframe.x64.exe", "Warframe"),
];

const GAME_LIBRARY_PATH_MARKERS: &[&str] = &[
    "\\steamapps\\common\\",
    "\\epic games\\",
    "\\riot games\\",
    "\\wegameapps\\",
    "\\rail_apps\\",
    "\\hoyoplay\\games\\",
    "\\mihoyo\\",
    "\\ubisoft game launcher\\games\\",
    "\\ea games\\",
    "\\xboxgames\\",
    "\\gog galaxy\\games\\",
    "\\blizzard\\",
];

const NON_GAME_HELPER_WORDS: &[&str] = &[
    "launcher",
    "updater",
    "update",
    "crash",
    "reporter",
    "unins",
    "setup",
    "install",
    "redist",
    "vcredist",
    "anticheat",
    "helper",
    "cef",
    "webhelper",
    "config",
    "overlay",
    "patcher",
];

fn clean_display_name(exe_name: &str, window_title: &str) -> String {
    let title = window_title.trim();
    if !title.is_empty() && title.chars().count() <= 48 {
        return title.to_string();
    }
    exe_name
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_string()
}

/// Pure, unit-testable Windows foreground game classifier.
pub fn classify_windows_foreground(
    exe_path: &str,
    window_title: &str,
    is_d3d_fullscreen: bool,
) -> Option<String> {
    let path_lower = exe_path.trim().replace('/', "\\").to_ascii_lowercase();
    let exe_name = path_lower.rsplit('\\').next().unwrap_or("");
    if exe_name.is_empty() {
        return None;
    }

    if EXCLUDED_EXES.contains(&exe_name) {
        return None;
    }

    // 1) Exact match against popular PC games
    for &(known_exe, display) in KNOWN_GAME_EXES {
        if exe_name == known_exe {
            return Some(display.to_string());
        }
    }

    // 2) Java Minecraft / modded launchers
    let title_lower = window_title.to_ascii_lowercase();
    if (exe_name == "javaw.exe" || exe_name == "java.exe")
        && (title_lower.contains("minecraft") || title_lower.contains("我的世界"))
    {
        return Some("Minecraft".to_string());
    }

    // 3) Unreal Engine shipping binaries (e.g. `*-Win64-Shipping.exe`, `*-WinGDK-Shipping.exe`)
    if exe_name.ends_with("-win64-shipping.exe")
        || exe_name.ends_with("-wingdk-shipping.exe")
        || exe_name.ends_with("_shipping.exe")
    {
        return Some(clean_display_name(exe_name, window_title));
    }

    // 4) Executable located inside a major game store library directory (excluding helper tools)
    if GAME_LIBRARY_PATH_MARKERS.iter().any(|m| path_lower.contains(m))
        && !NON_GAME_HELPER_WORDS.iter().any(|w| exe_name.contains(w))
    {
        return Some(clean_display_name(exe_name, window_title));
    }

    // 5) DirectX / D3D exclusive fullscreen reported by Windows Shell (excluding browsers/media above)
    if is_d3d_fullscreen && !NON_GAME_HELPER_WORDS.iter().any(|w| exe_name.contains(w)) {
        return Some(clean_display_name(exe_name, window_title));
    }

    None
}

#[cfg(any(target_os = "macos", test))]
pub fn classify_macos_foreground(bundle_id: &str, app_name: &str) -> Option<String> {
    let bid = bundle_id.trim().to_ascii_lowercase();
    let name = app_name.trim();
    let name_lower = name.to_ascii_lowercase();
    if bid.is_empty() && name_lower.is_empty() {
        return None;
    }

    // Exclude system/browsers/media/productivity
    if bid.starts_with("com.apple.")
        || bid.contains("google.chrome")
        || bid.contains("microsoft.edgemac")
        || bid.contains("mozilla.firefox")
        || bid.contains("brave")
        || bid.contains("vscode")
        || bid.contains("wechat")
        || bid.contains("tencent.qq")
        || bid.contains("obsproject")
        || bid.contains("videolan.vlc")
        || bid.contains("iina")
        || bid.contains("kurocat")
    {
        return None;
    }

    const MAC_GAME_KEYWORDS: &[&str] = &[
        "riotgames",
        "leagueoflegends",
        "blizzard",
        "hearthstone",
        "worldofwarcraft",
        "mihoyo",
        "hoyoverse",
        "genshin",
        "starrail",
        "minecraft",
        "roblox",
        "dota2",
        "csgo",
        "baldursgate3",
        "larian",
        "stardewvalley",
        "hollowknight",
        "hades",
        "balatro",
        "factorio",
        "rimworld",
        "civilization",
        "osu!",
        "unity.player",
        "unrealengine",
        "valvesoftware.source",
    ];
    if MAC_GAME_KEYWORDS
        .iter()
        .any(|k| bid.contains(k) || name_lower.contains(k))
    {
        return Some(if name.is_empty() { bid } else { name.to_string() });
    }
    None
}

/// Starts a super-lightweight background watcher that detects active PC games for BOTH
/// automatic Game Eco Mode (30 FPS GPU-saving pacing) and optional auto gaming headphones,
/// emitting `kuro-game-active` to the frontend and OBS.
pub fn start_game_detection_watcher(
    app: AppHandle,
    _settings: Arc<Mutex<AppSettings>>,
    paused_guard: Arc<AtomicBool>,
) {
    std::thread::spawn(move || {
        let mut active = false;
        let mut active_name: Option<String> = None;
        let mut active_needs_admin = false;
        let mut clear_streak: u8 = 0;
        // ~8s Alt-Tab grace window (4 ticks * 2000ms) so quick Alt-Tabs don't flicker Eco Mode / headphones
        const CLEAR_GRACE_TICKS: u8 = 4;
        #[cfg(windows)]
        let mut fg_cache = win_impl::ForegroundCache::default();

        loop {
            std::thread::sleep(Duration::from_millis(2000));

            let watcher_enabled = !paused_guard.load(Ordering::Relaxed);

            if !watcher_enabled {
                if active {
                    active = false;
                    active_name = None;
                    active_needs_admin = false;
                    clear_streak = 0;
                    GAME_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit(
                        "kuro-game-active",
                        GameActivePayload {
                            active: false,
                            game_name: None,
                            needs_admin: false,
                        },
                    );
                }
                continue;
            }

            #[cfg(windows)]
            let (detected, needs_admin) = win_impl::detect_foreground_game_cached(&mut fg_cache);
            #[cfg(target_os = "macos")]
            let (detected, needs_admin) = (mac_impl::detect_foreground_game(), false);
            #[cfg(all(not(windows), not(target_os = "macos")))]
            let (detected, needs_admin): (Option<String>, bool) = (None, false);

            if let Some(game_name) = detected {
                clear_streak = 0;
                if !active
                    || active_name.as_deref() != Some(game_name.as_str())
                    || active_needs_admin != needs_admin
                {
                    active = true;
                    active_name = Some(game_name.clone());
                    active_needs_admin = needs_admin;
                    GAME_ACTIVE.store(true, Ordering::Relaxed);
                    let _ = app.emit(
                        "kuro-game-active",
                        GameActivePayload {
                            active: true,
                            game_name: Some(game_name),
                            needs_admin,
                        },
                    );
                }
            } else if active {
                clear_streak = clear_streak.saturating_add(1);
                if clear_streak >= CLEAR_GRACE_TICKS {
                    active = false;
                    active_name = None;
                    active_needs_admin = false;
                    clear_streak = 0;
                    GAME_ACTIVE.store(false, Ordering::Relaxed);
                    let _ = app.emit(
                        "kuro-game-active",
                        GameActivePayload {
                            active: false,
                            game_name: None,
                            needs_admin: false,
                        },
                    );
                }
            }
        }
    });
}

#[cfg(windows)]
mod win_impl {
    use super::{classify_windows_foreground, should_suggest_admin_elevation};
    use std::ffi::c_void;
    use windows_sys::Win32::Foundation::{
        BOOL, CloseHandle, ERROR_ACCESS_DENIED, GetLastError, HANDLE,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    #[link(name = "advapi32")]
    extern "system" {
        fn OpenProcessToken(
            process_handle: HANDLE,
            desired_access: u32,
            token_handle: *mut HANDLE,
        ) -> BOOL;
        fn GetTokenInformation(
            token_handle: HANDLE,
            token_information_class: u32,
            token_information: *mut c_void,
            token_information_length: u32,
            return_length: *mut u32,
        ) -> BOOL;
    }

    const TOKEN_QUERY: u32 = 0x0008;
    const TOKEN_ELEVATION_CLASS: u32 = 20;

    #[repr(C)]
    struct TokenElevation {
        token_is_elevated: u32,
    }

    /// Read-only check whether a foreground process runs at a higher privilege level than us.
    /// From a non-elevated (Medium-IL) process, `OpenProcessToken(TOKEN_QUERY)` on a High-IL
    /// (Administrator) process fails with `ERROR_ACCESS_DENIED`, while on a Medium-IL process
    /// it succeeds with `token_is_elevated == 0`.
    unsafe fn is_process_elevated(hproc: HANDLE) -> bool {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(hproc, TOKEN_QUERY, &mut token) == 0 || token.is_null() {
            return GetLastError() == ERROR_ACCESS_DENIED;
        }
        let mut elevation = TokenElevation {
            token_is_elevated: 0,
        };
        let mut ret_len: u32 = 0;
        let ok = GetTokenInformation(
            token,
            TOKEN_ELEVATION_CLASS,
            (&mut elevation as *mut TokenElevation).cast(),
            std::mem::size_of::<TokenElevation>() as u32,
            &mut ret_len,
        );
        let _ = CloseHandle(token);
        ok != 0 && elevation.token_is_elevated != 0
    }

    #[derive(Default)]
    pub struct ForegroundCache {
        last_fg: isize,
        last_d3d_fs: bool,
        last_result: (Option<String>, bool),
    }

    pub fn detect_foreground_game_cached(cache: &mut ForegroundCache) -> (Option<String>, bool) {
        unsafe {
            let fg = GetForegroundWindow();
            if fg.is_null() {
                cache.last_fg = 0;
                cache.last_d3d_fs = false;
                cache.last_result = (None, false);
                return (None, false);
            }

            let mut quns: i32 = 0;
            let is_d3d_fs = SHQueryUserNotificationState(&mut quns) == 0
                && quns == QUNS_RUNNING_D3D_FULL_SCREEN;
            let fg_id = fg as isize;
            if fg_id == cache.last_fg && is_d3d_fs == cache.last_d3d_fs {
                return cache.last_result.clone();
            }

            let mut pid: u32 = 0;
            GetWindowThreadProcessId(fg, &mut pid);
            if pid == 0 {
                cache.last_fg = fg_id;
                cache.last_d3d_fs = is_d3d_fs;
                cache.last_result = (None, false);
                return (None, false);
            }

            let hproc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if hproc.is_null() {
                cache.last_fg = fg_id;
                cache.last_d3d_fs = is_d3d_fs;
                cache.last_result = (None, false);
                return (None, false);
            }

            let mut path_buf = [0u16; 512];
            let mut path_len: u32 = path_buf.len() as u32;
            let ok = QueryFullProcessImageNameW(hproc, 0, path_buf.as_mut_ptr(), &mut path_len);
            if ok == 0 || path_len == 0 {
                CloseHandle(hproc);
                cache.last_fg = fg_id;
                cache.last_d3d_fs = is_d3d_fs;
                cache.last_result = (None, false);
                return (None, false);
            }
            let exe_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);

            let mut title_buf = [0u16; 160];
            let title_len = GetWindowTextW(fg, title_buf.as_mut_ptr(), title_buf.len() as i32);
            let window_title = if title_len > 0 {
                String::from_utf16_lossy(&title_buf[..title_len as usize])
            } else {
                String::new()
            };

            let result = classify_windows_foreground(&exe_path, &window_title, is_d3d_fs);
            let self_elevated = crate::win_is_elevated();
            let target_elevated = if result.is_some() && !self_elevated {
                is_process_elevated(hproc)
            } else {
                false
            };
            CloseHandle(hproc);

            let needs_admin = should_suggest_admin_elevation(
                &exe_path,
                result.is_some(),
                target_elevated,
                self_elevated,
            );

            cache.last_fg = fg_id;
            cache.last_d3d_fs = is_d3d_fs;
            cache.last_result = (result.clone(), needs_admin);
            (result, needs_admin)
        }
    }
}

#[cfg(target_os = "macos")]
mod mac_impl {
    use super::classify_macos_foreground;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use objc2_foundation::NSString;

    pub fn detect_foreground_game() -> Option<String> {
        unsafe {
            let cls = AnyClass::get(c"NSWorkspace")?;
            let ws: *mut AnyObject = msg_send![cls, sharedWorkspace];
            if ws.is_null() {
                return None;
            }
            let app: *mut AnyObject = msg_send![ws, frontmostApplication];
            if app.is_null() {
                return None;
            }
            let bid_obj: *const NSString = msg_send![app, bundleIdentifier];
            let name_obj: *const NSString = msg_send![app, localizedName];
            let bid = if !bid_obj.is_null() {
                (*bid_obj).to_string()
            } else {
                String::new()
            };
            let name = if !name_obj.is_null() {
                (*name_obj).to_string()
            } else {
                String::new()
            };
            classify_macos_foreground(&bid, &name)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        classify_macos_foreground, classify_windows_foreground, should_suggest_admin_elevation,
    };

    #[test]
    fn suggests_admin_hint_only_for_elevated_non_kernel_anticheat_games() {
        assert!(should_suggest_admin_elevation(
            r"D:\Games\Genshin Impact\YuanShen.exe",
            true,
            true,
            false
        ));
        assert!(!should_suggest_admin_elevation(
            r"D:\Games\Genshin Impact\YuanShen.exe",
            true,
            true,
            true
        ));
        assert!(!should_suggest_admin_elevation(
            r"D:\SteamLibrary\steamapps\common\Hades\Hades.exe",
            true,
            false,
            false
        ));
        assert!(!should_suggest_admin_elevation(
            r"C:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe",
            true,
            true,
            false
        ));
        assert!(!should_suggest_admin_elevation(
            r"D:\WeGameApps\DeltaForce\DeltaForceClient-Win64-Shipping.exe",
            true,
            true,
            false
        ));
    }

    #[test]
    fn recognizes_known_games_and_engine_paths() {
        assert_eq!(
            classify_windows_foreground(r"C:\Riot Games\VALORANT\live\ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe", "VALORANT  ", false).as_deref(),
            Some("VALORANT")
        );
        assert_eq!(
            classify_windows_foreground(r"D:\Games\Genshin Impact\Genshin Impact Game\YuanShen.exe", "原神", false).as_deref(),
            Some("原神")
        );
        assert_eq!(
            classify_windows_foreground(r"D:\SteamLibrary\steamapps\common\Hollow Knight Silksong\Silksong.exe", "Silksong", false).as_deref(),
            Some("Silksong")
        );
        assert_eq!(
            classify_windows_foreground(r"C:\Program Files\Java\bin\javaw.exe", "Minecraft 1.21.4", false).as_deref(),
            Some("Minecraft")
        );
        assert_eq!(
            classify_windows_foreground(r"D:\Indie\MyCoolGame-Win64-Shipping.exe", "My Cool Game", false).as_deref(),
            Some("My Cool Game")
        );
        // Unknown D3D fullscreen game should be detected
        assert!(
            classify_windows_foreground(r"D:\CustomGames\SpaceRacer.exe", "Space Racer", true).is_some()
        );
    }

    #[test]
    fn rejects_browsers_video_players_office_and_launchers() {
        assert!(classify_windows_foreground(r"C:\Program Files\Google\Chrome\Application\chrome.exe", "YouTube", true).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\VideoLAN\VLC\vlc.exe", "Movie.mp4", true).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\Tencent\WeChat\WeChat.exe", "微信", false).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files (x86)\Steam\steam.exe", "Steam", false).is_none());
        assert!(classify_windows_foreground(r"D:\SteamLibrary\steamapps\common\SomeGame\CrashReporter.exe", "Crash Reporter", false).is_none());
        assert!(classify_windows_foreground(r"C:\Program Files\Java\bin\javaw.exe", "IntelliJ Helper", false).is_none());
        assert!(classify_macos_foreground("com.google.Chrome", "Google Chrome").is_none());
        assert!(classify_macos_foreground("com.riotgames.LeagueOfLegends", "League of Legends").is_some());
    }
}
