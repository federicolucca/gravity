//! The owner's profile for the client: who is signed in to Claude Code on
//! this machine (read from `~/.claude.json`, account fields only, never a
//! token) plus the name and avatar the owner picked in Gravity, which live in
//! the Gravity home.

use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use super::Conn;

const PROFILE_FILE: &str = "profile.json";
const MAX_NAME_CHARS: usize = 60;

/// The `oauthAccount` fields the profile shows; everything else stays on disk.
const ACCOUNT_FIELDS: &[&str] = &[
    "displayName",
    "fullName",
    "emailAddress",
    "organizationName",
    "organizationRole",
    "organizationType",
    "billingType",
    "seatTier",
    "userRateLimitTier",
    "accountCreatedAt",
    "subscriptionCreatedAt",
];

fn profile_path(home: &Path) -> PathBuf {
    home.join(PROFILE_FILE)
}

fn read_json(path: &Path) -> Value {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(Value::Null)
}

/// The signed-in Claude account, reduced to `ACCOUNT_FIELDS`, plus usage facts.
fn claude_account(user_home: &Path) -> Value {
    let config = read_json(&user_home.join(".claude.json"));
    let account = &config["oauthAccount"];
    let mut out: Map<String, Value> = ACCOUNT_FIELDS
        .iter()
        .filter_map(|key| {
            let value = account.get(*key)?;
            (!value.is_null()).then(|| ((*key).to_string(), value.clone()))
        })
        .collect();
    for key in ["claudeCodeFirstTokenDate", "numStartups"] {
        if let Some(value) = config.get(key).filter(|v| !v.is_null()) {
            out.insert(key.to_string(), value.clone());
        }
    }
    Value::Object(out)
}

/// Gravatar's address for an email (SHA-256 of the trimmed, lowercased
/// address); `d=404` makes a missing Gravatar fail so the client falls back.
fn gravatar_url(email: &str) -> String {
    let hash = Sha256::digest(email.trim().to_lowercase().as_bytes());
    format!("https://gravatar.com/avatar/{hash:x}?s=160&d=404")
}

impl Conn {
    /// `get_profile {}` → `{claude, display_name, avatar}`.
    pub(super) fn get_profile(&self, req_id: &Value, _req: &Value) -> anyhow::Result<()> {
        let own = read_json(&profile_path(&self.app.cfg.home));
        let claude = claude_account(&self.app.cfg.user_home);
        let gravatar = claude["emailAddress"].as_str().map(gravatar_url);
        self.send(json!({
            "type": "profile", "req_id": req_id,
            "claude": claude,
            "gravatar_url": gravatar,
            "display_name": own["display_name"].as_str().unwrap_or(""),
            "avatar": own["avatar"].as_str().unwrap_or(""),
        }));
        Ok(())
    }

    /// `save_profile {display_name, avatar}` → the profile as `get_profile` returns it.
    pub(super) fn save_profile(&self, req_id: &Value, req: &Value) -> anyhow::Result<()> {
        let name = req
            .get("display_name")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        anyhow::ensure!(
            name.chars().count() <= MAX_NAME_CHARS,
            "a name is at most {MAX_NAME_CHARS} characters"
        );
        let avatar = req.get("avatar").and_then(Value::as_str).unwrap_or("");
        anyhow::ensure!(
            avatar.is_empty() || avatar == "initials" || bus::avatar::parse(avatar).is_ok(),
            "unknown avatar"
        );
        crate::paths::atomic_write_json(
            &profile_path(&self.app.cfg.home),
            &json!({ "display_name": name, "avatar": avatar }),
        )?;
        self.get_profile(req_id, req)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gravatar_hashes_the_normalized_email() {
        assert_eq!(
            gravatar_url(" MyEmailAddress@example.com "),
            "https://gravatar.com/avatar/84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee?s=160&d=404"
        );
    }

    #[test]
    fn only_account_fields_leave_the_claude_config() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::write(
            tmp.path().join(".claude.json"),
            r#"{"oauthAccount":{"displayName":"Ada","emailAddress":"a@x","accountUuid":"secret-ish"},
                "numStartups":7,"userID":"u"}"#,
        )
        .unwrap();
        let account = claude_account(tmp.path());
        assert_eq!(account["displayName"], "Ada");
        assert_eq!(account["numStartups"], 7);
        assert!(account.get("accountUuid").is_none());
        assert!(account.get("userID").is_none());
    }
}
