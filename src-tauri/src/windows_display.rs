use std::{mem::size_of, thread, time::Duration};

use tauri::menu::{CheckMenuItem, Submenu};
use tauri::window::Monitor;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};
use windows_sys::Win32::Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW};
use windows_sys::Win32::UI::WindowsAndMessaging::EDD_GET_DEVICE_INTERFACE_NAME;

use crate::config::{save_settings, AppSettings};
use crate::{win7_layered, win_needs_win7_ulw, window_dimensions, AppState};

const DISPLAY_ITEM_PREFIX: &str = "win_display:";
const FREE_PLACEMENT_ITEM: &str = "win_display_free";

#[derive(Clone, PartialEq)]
struct Display {
    id: String,
    name: String,
    origin: PhysicalPosition<i32>,
    work_size: PhysicalSize<u32>,
    scale_factor: f64,
    primary: bool,
}

#[derive(Clone, Copy)]
pub struct Placement {
    pub position: PhysicalPosition<i32>,
    pub size: PhysicalSize<u32>,
}

struct DisplayMenu(Submenu<tauri::Wry>);

fn decode_windows_string(value: &[u16]) -> String {
    let end = value
        .iter()
        .position(|&unit| unit == 0)
        .unwrap_or(value.len());
    String::from_utf16_lossy(&value[..end])
}

fn display_identity(name: &str) -> (String, String) {
    let device_name: Vec<u16> = name.encode_utf16().chain([0]).collect();
    let mut target: DISPLAY_DEVICEW = unsafe { std::mem::zeroed() };
    target.cb = size_of::<DISPLAY_DEVICEW>() as u32;
    // The interface path identifies the attached display rather than its current DISPLAY number.
    let found = unsafe {
        EnumDisplayDevicesW(
            device_name.as_ptr(),
            0,
            &mut target,
            EDD_GET_DEVICE_INTERFACE_NAME,
        )
    };
    let path = decode_windows_string(&target.DeviceID);
    let label = decode_windows_string(&target.DeviceString);
    let id = if found != 0 && !path.is_empty() {
        path
    } else {
        name.to_owned()
    };
    (id, label)
}

fn connected_displays(window: &WebviewWindow) -> Vec<Display> {
    let primary = window.primary_monitor().ok().flatten();
    let mut displays: Vec<_> = window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|monitor| {
            let name = monitor.name()?;
            let (id, name) = display_identity(name);
            let work_area = monitor.work_area();
            let (origin, work_size) = if work_area.size.width > 0 && work_area.size.height > 0 {
                (work_area.position, work_area.size)
            } else {
                (*monitor.position(), *monitor.size())
            };
            Some(Display {
                id,
                name,
                origin,
                work_size,
                scale_factor: monitor.scale_factor(),
                primary: primary.as_ref().and_then(Monitor::name) == monitor.name()
                    && primary.is_some(),
            })
        })
        .collect();
    displays.sort_by_key(|display| (!display.primary, display.origin.x, display.origin.y));
    displays
}

fn target_display<'a>(displays: &'a [Display], preferred: Option<&str>) -> Option<&'a Display> {
    preferred
        .and_then(|id| displays.iter().find(|display| display.id == id))
        .or_else(|| displays.first())
}

fn bottom_right(display: &Display, width: f64, height: f64) -> Placement {
    let scale = display.scale_factor;
    let size = PhysicalSize::new(
        (width * scale).round() as u32,
        (height * scale).round() as u32,
    );
    let right_padding = (28.0 * scale).round() as u32;
    let bottom_padding = (16.0 * scale).round() as u32;
    let x = display.origin.x
        + display
            .work_size
            .width
            .saturating_sub(size.width + right_padding) as i32;
    let y = display.origin.y
        + display
            .work_size
            .height
            .saturating_sub(size.height + bottom_padding) as i32;
    Placement {
        position: PhysicalPosition::new(x, y),
        size,
    }
}

fn placement(
    displays: &[Display],
    preferred: Option<&str>,
    settings: &AppSettings,
) -> Option<Placement> {
    let (width, height) = window_dimensions(&settings.keyboard_layout, settings.scale);
    Some(bottom_right(
        target_display(displays, preferred)?,
        width,
        height,
    ))
}

pub fn initial_placement(window: &WebviewWindow, settings: &AppSettings) -> Option<Placement> {
    let preferred = settings.windows_display_id.as_deref();
    if preferred.is_none() && settings.x.is_some() && settings.y.is_some() {
        return None;
    }
    placement(&connected_displays(window), preferred, settings)
}

fn apply(window: &WebviewWindow, target: Placement) -> tauri::Result<()> {
    if win_needs_win7_ulw() {
        window.set_size(target.size)?;
        win7_layered::set_position(target.position.x, target.position.y);
        if win7_layered::is_overlay_active() {
            window.set_position(target.position)?;
        }
    } else {
        window.set_position(target.position)?;
        window.set_size(target.size)?;
    }
    Ok(())
}

pub fn resize_pinned(
    window: &WebviewWindow,
    preferred: &str,
    width: f64,
    height: f64,
) -> Option<(i32, i32)> {
    let displays = connected_displays(window);
    let target = bottom_right(target_display(&displays, Some(preferred))?, width, height);
    apply(window, target).ok()?;
    Some((target.position.x, target.position.y))
}

pub fn reset_position(app: &AppHandle, window: &WebviewWindow) -> bool {
    let state = app.state::<AppState>();
    let mut settings = state.settings.lock().unwrap();
    let Some(target) = placement(
        &connected_displays(window),
        settings.windows_display_id.as_deref(),
        &settings,
    ) else {
        return false;
    };
    if apply(window, target).is_err() {
        return false;
    }
    settings.x = Some(target.position.x);
    settings.y = Some(target.position.y);
    save_settings(&settings);
    true
}

pub fn remember_dragged_position(app: &AppHandle, position: PhysicalPosition<i32>) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(window) = handle.get_webview_window("main") else {
            return;
        };
        let state = handle.state::<AppState>();
        let snapshot = state.settings.lock().unwrap().clone();
        let should_unpin = snapshot.windows_display_id.as_deref().is_some_and(|id| {
            placement(&connected_displays(&window), Some(id), &snapshot).is_some_and(|target| {
                position.x.abs_diff(target.position.x) > 1
                    || position.y.abs_diff(target.position.y) > 1
            })
        });
        let updated = {
            let mut settings = state.settings.lock().unwrap();
            let unpinned =
                should_unpin && settings.windows_display_id == snapshot.windows_display_id;
            if unpinned {
                settings.windows_display_id = None;
            }
            if unpinned || settings.x != Some(position.x) || settings.y != Some(position.y) {
                settings.x = Some(position.x);
                settings.y = Some(position.y);
                save_settings(&settings);
            }
            unpinned.then(|| settings.clone())
        };
        if let Some(settings) = updated {
            let _ = refresh_menu(&handle, &connected_displays(&window));
            let _ = handle.emit("kuro-settings", settings);
        }
    });
}

fn refresh_menu(app: &AppHandle, displays: &[Display]) -> tauri::Result<()> {
    let menu = app.state::<DisplayMenu>();
    let preferred = app
        .state::<AppState>()
        .settings
        .lock()
        .unwrap()
        .windows_display_id
        .clone();
    let selected = preferred
        .as_deref()
        .and_then(|id| target_display(displays, Some(id)));
    for index in (0..menu.0.items()?.len()).rev() {
        menu.0.remove_at(index)?;
    }
    for (index, display) in displays.iter().enumerate() {
        let role = if display.primary {
            "主显示器".to_owned()
        } else {
            format!("显示器 {}", index + 1)
        };
        let label = if display.name.is_empty() {
            role
        } else {
            format!("{}（{}）", display.name, role)
        };
        menu.0.append(&CheckMenuItem::with_id(
            app,
            format!("{DISPLAY_ITEM_PREFIX}{}", display.id),
            label,
            true,
            selected.is_some_and(|selected| selected.id == display.id),
            None::<&str>,
        )?)?;
    }
    menu.0.append(&CheckMenuItem::with_id(
        app,
        FREE_PLACEMENT_ITEM,
        "自由摆放",
        true,
        preferred.is_none(),
        None::<&str>,
    )?)
}

pub fn create_menu(app: &AppHandle) -> tauri::Result<Submenu<tauri::Wry>> {
    let menu = Submenu::with_id(app, "win_display_menu", "选择显示器", true)?;
    app.manage(DisplayMenu(menu.clone()));
    if let Some(window) = app.get_webview_window("main") {
        let displays = connected_displays(&window);
        refresh_menu(app, &displays)?;
        watch_topology(app.clone(), displays);
    }
    Ok(menu)
}

fn watch_topology(app: AppHandle, mut previous: Vec<Display>) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_secs(1));
        let Some(window) = app.get_webview_window("main") else {
            break;
        };
        if app
            .state::<AppState>()
            .dragging
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            continue;
        }
        let displays = connected_displays(&window);
        if displays.is_empty() || displays == previous {
            continue;
        }
        previous.clone_from(&displays);
        let handle = app.clone();
        let queued = app.run_on_main_thread(move || {
            update_placement(&handle, &window, &displays);
        });
        if queued.is_err() {
            break;
        }
    });
}

fn update_placement(app: &AppHandle, window: &WebviewWindow, displays: &[Display]) {
    let snapshot = app.state::<AppState>().settings.lock().unwrap().clone();
    if let Some(id) = snapshot.windows_display_id.as_deref() {
        if let Some(target) = placement(displays, Some(id), &snapshot) {
            let _ = apply(window, target);
        }
    }
    let _ = refresh_menu(app, displays);
}

pub fn refresh_placement(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window("main") {
            update_placement(&handle, &window, &connected_displays(&window));
        }
    });
}

pub fn handle_menu(app: &AppHandle, item_id: &str) {
    let preferred = match item_id.strip_prefix(DISPLAY_ITEM_PREFIX) {
        Some(id) => Some(id.to_owned()),
        None if item_id == FREE_PLACEMENT_ITEM => None,
        None => return,
    };
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let displays = connected_displays(&window);
    let state = app.state::<AppState>();
    let snapshot = state.settings.lock().unwrap().clone();
    let position = if let Some(id) = preferred.as_deref() {
        let Some(target) = placement(&displays, Some(id), &snapshot) else {
            return;
        };
        if apply(&window, target).is_err() {
            return;
        }
        Some(target.position)
    } else if win_needs_win7_ulw() {
        win7_layered::get_rect().map(|(x, y, _, _)| PhysicalPosition::new(x, y))
    } else {
        window.outer_position().ok()
    };
    let updated = {
        let mut settings = state.settings.lock().unwrap();
        settings.windows_display_id = preferred;
        if let Some(position) = position {
            settings.x = Some(position.x);
            settings.y = Some(position.y);
        }
        save_settings(&settings);
        settings.clone()
    };
    let _ = refresh_menu(app, &displays);
    let _ = app.emit("kuro-settings", updated);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: &str, x: i32, primary: bool, scale_factor: f64) -> Display {
        Display {
            id: id.into(),
            name: id.into(),
            origin: PhysicalPosition::new(x, -100),
            work_size: PhysicalSize::new(1920, 1040),
            scale_factor,
            primary,
        }
    }

    #[test]
    fn uses_target_dpi_and_work_area_on_a_display_left_of_primary() {
        let placement = bottom_right(&display("external", -1920, false, 1.5), 420.0, 440.0);
        assert_eq!(placement.size, PhysicalSize::new(630, 660));
        assert_eq!(placement.position, PhysicalPosition::new(-672, 256));
    }

    #[test]
    fn missing_preference_falls_back_to_primary() {
        let connected = [
            display("main", 0, true, 1.0),
            display("external", -1920, false, 1.5),
        ];
        assert_eq!(
            target_display(&connected, Some("external")).unwrap().id,
            "external"
        );
        assert_eq!(
            target_display(&connected, Some("unplugged")).unwrap().id,
            "main"
        );
    }
}
