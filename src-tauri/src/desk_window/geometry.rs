// Physical desktop geometry and DPI conversion, independent of live windows.
use serde::{Deserialize, Serialize};
use tauri::PhysicalSize;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub(super) struct Rect {
    pub(super) x: i32,
    pub(super) y: i32,
    pub(super) width: u32,
    pub(super) height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(super) struct Placement {
    pub(super) normal: Rect,
    pub(super) scale: f64,
    pub(super) monitor_x: i32,
    pub(super) monitor_y: i32,
    pub(super) maximized: bool,
}

#[derive(Clone, Copy)]
pub(super) struct Screen {
    pub(super) area: Rect,
    pub(super) x: i32,
    pub(super) y: i32,
    pub(super) scale: f64,
}

fn overlap(a: Rect, b: Rect) -> i64 {
    let width = (i64::from(a.x) + i64::from(a.width)).min(i64::from(b.x) + i64::from(b.width))
        - i64::from(a.x.max(b.x));
    let height = (i64::from(a.y) + i64::from(a.height)).min(i64::from(b.y) + i64::from(b.height))
        - i64::from(a.y.max(b.y));
    width.max(0) * height.max(0)
}

// Persist physical screen coordinates plus their DPI. Convert monitor-relative
// offsets and size once on restore; never scale a multi-monitor global origin.
pub(super) fn restore(saved: &Placement, screens: &[Screen], primary: Screen) -> Rect {
    let target = screens
        .iter()
        .max_by_key(|monitor| overlap(saved.normal, monitor.area));
    let visible = target.filter(|monitor| overlap(saved.normal, monitor.area) > 0);
    let target = visible.copied().unwrap_or(primary);
    let ratio = target.scale / saved.scale;
    let width =
        ((f64::from(saved.normal.width) * ratio).round() as u32).clamp(1, target.area.width);
    let height =
        ((f64::from(saved.normal.height) * ratio).round() as u32).clamp(1, target.area.height);
    let (x, y) = if visible.is_some() {
        (
            target.x
                + ((f64::from(saved.normal.x) - f64::from(saved.monitor_x)) * ratio).round() as i32,
            target.y
                + ((f64::from(saved.normal.y) - f64::from(saved.monitor_y)) * ratio).round() as i32,
        )
    } else {
        (
            target.area.x + ((target.area.width - width) / 2) as i32,
            target.area.y + ((target.area.height - height) / 2) as i32,
        )
    };
    Rect {
        x: x.clamp(
            target.area.x,
            target.area.x + (target.area.width - width) as i32,
        ),
        y: y.clamp(
            target.area.y,
            target.area.y + (target.area.height - height) as i32,
        ),
        width,
        height,
    }
}

pub(super) fn client_size(
    bounds: Rect,
    outer: PhysicalSize<u32>,
    inner: PhysicalSize<u32>,
) -> PhysicalSize<u32> {
    PhysicalSize::new(
        bounds
            .width
            .saturating_sub(outer.width.saturating_sub(inner.width))
            .max(1),
        bounds
            .height
            .saturating_sub(outer.height.saturating_sub(inner.height))
            .max(1),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn monitor(scale: f64) -> Screen {
        Screen {
            area: Rect {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
            },
            x: 0,
            y: 0,
            scale,
        }
    }
    fn placement() -> Placement {
        Placement {
            normal: Rect {
                x: 100,
                y: 80,
                width: 1000,
                height: 700,
            },
            scale: 1.0,
            monitor_x: 0,
            monitor_y: 0,
            maximized: true,
        }
    }
    #[test]
    fn restoring_outer_bounds_does_not_add_resize_borders() {
        assert_eq!(
            client_size(
                placement().normal,
                PhysicalSize::new(1116, 729),
                PhysicalSize::new(1100, 720)
            ),
            PhysicalSize::new(984, 691)
        );
    }
    #[test]
    fn dpi_round_trip_preserves_normal_geometry() {
        let mut saved = placement();
        let scaled = restore(&saved, &[monitor(1.25)], monitor(1.25));
        assert_eq!(
            scaled,
            Rect {
                x: 125,
                y: 100,
                width: 1250,
                height: 875
            }
        );
        saved.normal = scaled;
        saved.scale = 1.25;
        assert_eq!(
            restore(&saved, &[monitor(1.0)], monitor(1.0)),
            placement().normal
        );
    }
    #[test]
    fn unplugged_monitor_centers_and_caps_size() {
        let mut saved = placement();
        saved.normal.x = 3000;
        assert_eq!(
            restore(&saved, &[monitor(1.0)], monitor(1.0)),
            Rect {
                x: 460,
                y: 170,
                width: 1000,
                height: 700
            }
        );
        saved.normal.width = 4000;
        saved.normal.height = 3000;
        assert_eq!(
            restore(&saved, &[monitor(1.25)], monitor(1.25)),
            monitor(1.25).area
        );
    }
    #[test]
    fn secondary_monitor_origin_is_not_scaled() {
        let second = Screen {
            area: Rect {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1040,
            },
            x: -1920,
            y: 0,
            scale: 1.25,
        };
        let mut saved = placement();
        saved.monitor_x = -1920;
        saved.normal.x = -1820;
        assert_eq!(
            restore(&saved, &[monitor(1.0), second], monitor(1.0)).x,
            -1795
        );
    }
}
