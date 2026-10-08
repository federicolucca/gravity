//! Live stats of the machine the daemon runs on, for the client's machine
//! panel: CPU, memory, disks, temperatures, network and the busiest
//! processes. Read straight from `/proc` and `/sys` over a short sampling
//! window, so nothing else has to be installed. Linux only.

use serde_json::{json, Value};

use super::Conn;

impl Conn {
    /// `machine_stats {}` → `{type:"machine_stats", stats}`.
    /// `prepare_restart {minutes}` → `{draining}`: holds new work back so busy
    /// bots can finish before the daemon restarts; 0 minutes ends the drain.
    pub(super) fn prepare_restart(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let minutes = req.get("minutes").and_then(Value::as_u64).unwrap_or(10);
        crate::drain::start(minutes);
        self.send(json!({
            "type": "restart_prepared",
            "req_id": req_id,
            "draining": crate::drain::active(),
        }));
        Ok(())
    }

    pub(super) fn machine_stats(&self, req_id: &Value, _req: &Value) -> anyhow::Result<()> {
        let out = self.out.clone();
        let req_id = req_id.clone();
        tokio::task::spawn_blocking(move || {
            let reply = match linux::collect() {
                Ok(stats) => json!({ "type": "machine_stats", "req_id": req_id, "stats": stats }),
                Err(e) => json!({
                    "type": "error", "req_id": req_id,
                    "code": "internal", "message": e.to_string()
                }),
            };
            let _ = out.send(reply);
        });
        Ok(())
    }
}

impl Conn {
    /// `stop_process {pid, force?}` → `{pid}`: SIGTERM, or SIGKILL with `force`.
    ///
    /// Only what the daemon's own user may signal can be stopped (the kernel
    /// enforces that), and never the daemon itself, its parent or init.
    pub(super) fn stop_process(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let pid = req
            .get("pid")
            .and_then(Value::as_u64)
            .and_then(|pid| i32::try_from(pid).ok())
            .ok_or_else(|| anyhow::anyhow!("pid is required"))?;
        let force = req.get("force").and_then(Value::as_bool).unwrap_or(false);
        linux::stop(pid, force)?;
        self.send(json!({ "type": "process_stopped", "req_id": req_id, "pid": pid }));
        Ok(())
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use std::collections::HashMap;
    use std::ffi::CString;
    use std::fs;
    use std::time::{Duration, Instant};

    use serde_json::{json, Value};

    const WINDOW: Duration = Duration::from_millis(400);
    const TOP_PROCESSES: usize = 8;
    /// Filesystems worth showing; pseudo and snap mounts are left out.
    const REAL_FS: &[&str] = &[
        "ext4", "ext3", "xfs", "btrfs", "vfat", "exfat", "ntfs3", "fuseblk", "zfs",
    ];

    fn read(path: &str) -> String {
        fs::read_to_string(path).unwrap_or_default()
    }

    /// Per-CPU `(busy, total)` jiffies; index 0 is the aggregate line.
    pub(super) fn cpu_times(stat: &str) -> Vec<(u64, u64)> {
        stat.lines()
            .filter(|line| line.starts_with("cpu"))
            .map(|line| {
                let fields: Vec<u64> = line
                    .split_whitespace()
                    .skip(1)
                    .filter_map(|f| f.parse().ok())
                    .collect();
                let total: u64 = fields.iter().take(8).sum();
                // idle + iowait are not busy.
                let idle =
                    fields.get(3).copied().unwrap_or(0) + fields.get(4).copied().unwrap_or(0);
                (total.saturating_sub(idle), total)
            })
            .collect()
    }

    fn percent(before: (u64, u64), after: (u64, u64)) -> f64 {
        let total = after.1.saturating_sub(before.1);
        if total == 0 {
            return 0.0;
        }
        (after.0.saturating_sub(before.0) as f64 * 100.0 / total as f64).min(100.0)
    }

    fn net_bytes() -> HashMap<String, (u64, u64)> {
        read("/proc/net/dev")
            .lines()
            .skip(2)
            .filter_map(|line| {
                let (name, rest) = line.split_once(':')?;
                let name = name.trim();
                if name == "lo" {
                    return None;
                }
                let f: Vec<u64> = rest
                    .split_whitespace()
                    .filter_map(|x| x.parse().ok())
                    .collect();
                Some((name.to_string(), (*f.first()?, *f.get(8)?)))
            })
            .collect()
    }

    /// `pid → (name, cpu jiffies, rss pages)`.
    fn processes() -> HashMap<u32, (String, u64, u64)> {
        let Ok(dir) = fs::read_dir("/proc") else {
            return HashMap::new();
        };
        dir.filter_map(Result::ok)
            .filter_map(|entry| {
                let pid: u32 = entry.file_name().to_str()?.parse().ok()?;
                let stat = fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
                let open = stat.find('(')?;
                let close = stat.rfind(')')?;
                let name = stat.get(open + 1..close)?.to_string();
                let rest: Vec<&str> = stat.get(close + 2..)?.split_whitespace().collect();
                // Fields after the name start at state (3); utime is 14, stime 15, rss 24.
                let utime: u64 = rest.get(11)?.parse().ok()?;
                let stime: u64 = rest.get(12)?.parse().ok()?;
                let rss: u64 = rest.get(21)?.parse().ok()?;
                Some((pid, (name, utime + stime, rss)))
            })
            .collect()
    }

    fn meminfo() -> HashMap<String, u64> {
        read("/proc/meminfo")
            .lines()
            .filter_map(|line| {
                let (key, value) = line.split_once(':')?;
                let kib: u64 = value.split_whitespace().next()?.parse().ok()?;
                Some((key.to_string(), kib * 1024))
            })
            .collect()
    }

    fn disks() -> Vec<Value> {
        let mut seen = Vec::new();
        read("/proc/mounts")
            .lines()
            .filter_map(|line| {
                let f: Vec<&str> = line.split_whitespace().collect();
                let (device, mount, fs_type) = (*f.first()?, *f.get(1)?, *f.get(2)?);
                if !REAL_FS.contains(&fs_type) || seen.contains(&device.to_string()) {
                    return None;
                }
                seen.push(device.to_string());
                let path = CString::new(mount.replace("\\040", " ")).ok()?;
                // SAFETY: `path` is NUL-terminated and `st` is a valid out-pointer.
                let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
                if unsafe { libc::statvfs(path.as_ptr(), &mut st) } != 0 {
                    return None;
                }
                let block = st.f_frsize as u64;
                let total = st.f_blocks as u64 * block;
                (total > 0).then(|| {
                    json!({
                        "mount": mount, "device": device, "fs": fs_type,
                        "total": total, "free": st.f_bavail as u64 * block,
                    })
                })
            })
            .collect()
    }

    /// One entry per sensor chip: its hottest reading and the labelled ones.
    fn temperatures() -> Vec<Value> {
        let Ok(dir) = fs::read_dir("/sys/class/hwmon") else {
            return Vec::new();
        };
        let mut chips: Vec<Value> = dir
            .filter_map(Result::ok)
            .filter_map(|chip| {
                let path = chip.path();
                let name = fs::read_to_string(path.join("name")).ok()?.trim().to_string();
                let mut readings: Vec<(String, f64)> = fs::read_dir(&path)
                    .ok()?
                    .filter_map(Result::ok)
                    .filter_map(|file| {
                        let file_name = file.file_name().into_string().ok()?;
                        let stem = file_name.strip_suffix("_input")?;
                        stem.starts_with("temp").then_some(())?;
                        let milli: f64 = fs::read_to_string(file.path()).ok()?.trim().parse().ok()?;
                        let label = fs::read_to_string(path.join(format!("{stem}_label")))
                            .map(|l| l.trim().to_string())
                            .unwrap_or_else(|_| stem.to_string());
                        Some((label, milli / 1000.0))
                    })
                    .collect();
                readings.sort_by(|a, b| a.0.cmp(&b.0));
                let max = readings.iter().map(|r| r.1).fold(f64::MIN, f64::max);
                (!readings.is_empty()).then(|| {
                    json!({
                        "chip": name, "max": max,
                        "readings": readings.iter().map(|(l, c)| json!({"label": l, "celsius": c})).collect::<Vec<_>>(),
                    })
                })
            })
            .collect();
        chips.sort_by(|a, b| a["chip"].as_str().cmp(&b["chip"].as_str()));
        chips
    }

    fn os_name() -> String {
        read("/etc/os-release")
            .lines()
            .find_map(|line| line.strip_prefix("PRETTY_NAME="))
            .map(|v| v.trim_matches('"').to_string())
            .unwrap_or_else(|| "Linux".to_string())
    }

    pub(super) fn stop(pid: i32, force: bool) -> anyhow::Result<()> {
        // SAFETY: getpid/getppid have no preconditions.
        let (own, parent) = unsafe { (libc::getpid(), libc::getppid()) };
        anyhow::ensure!(
            pid > 1 && pid != own && pid != parent,
            "this process cannot be stopped from here"
        );
        let signal = if force { libc::SIGKILL } else { libc::SIGTERM };
        // SAFETY: kill only sends a signal; the kernel checks permission.
        if unsafe { libc::kill(pid, signal) } != 0 {
            let err = std::io::Error::last_os_error();
            anyhow::bail!(match err.raw_os_error() {
                Some(libc::EPERM) => "not allowed: the process belongs to another user".to_string(),
                Some(libc::ESRCH) => "the process has already exited".to_string(),
                _ => err.to_string(),
            });
        }
        Ok(())
    }

    pub(super) fn collect() -> anyhow::Result<Value> {
        let cpu_before = cpu_times(&read("/proc/stat"));
        anyhow::ensure!(!cpu_before.is_empty(), "/proc/stat is not readable");
        let net_before = net_bytes();
        let procs_before = processes();
        let started = Instant::now();
        std::thread::sleep(WINDOW);
        let cpu_after = cpu_times(&read("/proc/stat"));
        let net_after = net_bytes();
        let procs_after = processes();
        let secs = started.elapsed().as_secs_f64();

        let cores: Vec<f64> = cpu_before
            .iter()
            .zip(&cpu_after)
            .skip(1)
            .map(|(b, a)| percent(*b, *a))
            .collect();
        let total_jiffies = cpu_after[0].1.saturating_sub(cpu_before[0].1).max(1) as f64;
        // SAFETY: sysconf has no preconditions.
        let page = unsafe { libc::sysconf(libc::_SC_PAGESIZE) }.max(4096) as u64;
        let mut top: Vec<Value> = procs_after
            .iter()
            .filter_map(|(pid, (name, cpu, rss))| {
                let before = procs_before.get(pid)?.1;
                let share =
                    cpu.saturating_sub(before) as f64 * 100.0 * cores.len() as f64 / total_jiffies;
                Some(json!({ "pid": pid, "name": name, "cpu": share, "rss": rss * page }))
            })
            .collect();
        top.sort_by(|a, b| {
            b["cpu"]
                .as_f64()
                .unwrap_or(0.0)
                .total_cmp(&a["cpu"].as_f64().unwrap_or(0.0))
                .then(b["rss"].as_u64().cmp(&a["rss"].as_u64()))
        });
        top.truncate(TOP_PROCESSES);

        let mut net: Vec<Value> = net_after
            .iter()
            .filter_map(|(name, (rx, tx))| {
                let (rx0, tx0) = net_before.get(name)?;
                Some(json!({
                    "iface": name, "rx_total": rx, "tx_total": tx,
                    "rx_rate": rx.saturating_sub(*rx0) as f64 / secs,
                    "tx_rate": tx.saturating_sub(*tx0) as f64 / secs,
                }))
            })
            .collect();
        net.sort_by(|a, b| a["iface"].as_str().cmp(&b["iface"].as_str()));

        let mem = meminfo();
        let get = |key: &str| mem.get(key).copied().unwrap_or(0);
        let load: Vec<f64> = read("/proc/loadavg")
            .split_whitespace()
            .take(3)
            .filter_map(|v| v.parse().ok())
            .collect();
        let uptime: f64 = read("/proc/uptime")
            .split_whitespace()
            .next()
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.0);
        let cpu_model = read("/proc/cpuinfo")
            .lines()
            .find_map(|line| line.strip_prefix("model name"))
            .and_then(|rest| rest.split_once(':'))
            .map(|(_, v)| v.trim().to_string())
            .unwrap_or_default();

        Ok(json!({
            "hostname": read("/proc/sys/kernel/hostname").trim(),
            "os": os_name(),
            "kernel": read("/proc/sys/kernel/osrelease").trim(),
            "uptime_secs": uptime,
            "cpu_model": cpu_model,
            "cpu": percent(cpu_before[0], cpu_after[0]),
            "cores": cores,
            "load": load,
            "memory": { "total": get("MemTotal"), "available": get("MemAvailable") },
            "swap": { "total": get("SwapTotal"), "free": get("SwapFree") },
            "disks": disks(),
            "temperatures": temperatures(),
            "network": net,
            "processes": top,
        }))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn cpu_busy_share_excludes_idle_and_iowait() {
            let before = cpu_times("cpu  10 0 10 70 10 0 0 0 0 0\ncpu0 10 0 10 70 10 0 0 0 0 0\n");
            let after = cpu_times("cpu  30 0 30 120 20 0 0 0 0 0\ncpu0 30 0 30 120 20 0 0 0 0 0\n");
            assert_eq!(before.len(), 2);
            // busy +40 of total +100.
            assert!((percent(before[0], after[0]) - 40.0).abs() < 1e-9);
        }

        #[test]
        fn the_daemon_and_init_cannot_be_stopped() {
            assert!(stop(1, false).is_err());
            assert!(stop(std::process::id() as i32, false).is_err());
        }

        #[test]
        fn collect_reads_this_machine() {
            let stats = collect().unwrap();
            assert!(stats["memory"]["total"].as_u64().unwrap() > 0);
            assert!(!stats["cores"].as_array().unwrap().is_empty());
        }
    }
}

#[cfg(not(target_os = "linux"))]
mod linux {
    pub(super) fn stop(_pid: i32, _force: bool) -> anyhow::Result<()> {
        anyhow::bail!("stopping processes is only available on Linux")
    }

    pub(super) fn collect() -> anyhow::Result<serde_json::Value> {
        anyhow::bail!("machine stats are only available on Linux")
    }
}
