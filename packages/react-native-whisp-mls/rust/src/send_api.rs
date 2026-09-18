use crate::MlsError;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{io::Read, time::Duration};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SendConfig {
    pub root: String,
    pub user_id: String,
    pub device_id: String,
    pub storage_key: String,
    pub cookie: String,
    pub base_url: String,
    pub uploadthing_version: String,
    #[serde(default)]
    pub allow_insecure_http: bool,
}
impl SendConfig {
    pub fn parse(value: &str) -> Result<Self, MlsError> {
        let config: Self = serde_json::from_str(value)
            .map_err(|_| MlsError::protocol("send configuration decoding"))?;
        uuid::Uuid::parse_str(&config.device_id)
            .map_err(|_| MlsError::protocol("send device ID validation"))?;
        let url = reqwest::Url::parse(&config.base_url)
            .map_err(|_| MlsError::protocol("send server URL validation"))?;
        if !std::path::Path::new(&config.root).is_absolute()
            || config.user_id.is_empty()
            || config.cookie.is_empty()
            || !(url.scheme() == "https"
                || ((config.allow_insecure_http || cfg!(debug_assertions))
                    && url.scheme() == "http"))
        {
            return Err(MlsError::protocol("send configuration validation"));
        }
        Ok(config)
    }
}
pub(crate) struct Api<'a> {
    pub config: &'a SendConfig,
    client: Client,
}
impl<'a> Api<'a> {
    pub fn new(config: &'a SendConfig) -> Result<Self, MlsError> {
        Ok(Self {
            config,
            client: Client::builder()
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(|_| MlsError::protocol("send HTTP client creation"))?,
        })
    }
    pub fn call<T: DeserializeOwned>(
        &self,
        name: &str,
        mutation: bool,
        input: Value,
    ) -> Result<T, MlsError> {
        let url = format!(
            "{}/api/trpc/mls.{name}",
            self.config.base_url.trim_end_matches('/')
        );
        let input = json!({"json": input});
        let request = if mutation {
            self.client.post(url).json(&input)
        } else {
            self.client.get(url).query(&[("input", input.to_string())])
        };
        let response = request
            .header("Cookie", &self.config.cookie)
            .header("x-trpc-source", "native-send")
            .send()
            .map_err(|_| MlsError::Transport)?;
        let response = successful_response(response, name)?;
        let body: Value = response
            .json()
            .map_err(|_| MlsError::protocol("send server response decoding"))?;
        serde_json::from_value(body["result"]["data"]["json"].clone())
            .map_err(|_| MlsError::protocol("send server response validation"))
    }
    pub fn presign(&self, draft: &str, size: u64) -> Result<String, MlsError> {
        #[derive(Deserialize)]
        struct Target {
            url: String,
        }
        let response = self.client.post(format!("{}/api/uploadthing?actionType=upload&slug=imageUploader", self.config.base_url.trim_end_matches('/')))
            .header("Cookie", &self.config.cookie).header("x-uploadthing-package", "react-native-uploadthing-background")
            .header("x-uploadthing-version", &self.config.uploadthing_version)
            .json(&json!({"files":[{"name":format!("{draft}.age"),"size":size,"type":"application/octet-stream","lastModified":0}],"input":{"draftId":draft}}))
            .send().map_err(|_| MlsError::Transport)?;
        let response = successful_response(response, "authorize")?;
        let targets: Vec<Target> = response
            .json()
            .map_err(|_| MlsError::protocol("encrypted upload target decoding"))?;
        let [target] = targets.as_slice() else {
            return Err(MlsError::protocol("encrypted upload target count"));
        };
        let url = reqwest::Url::parse(&target.url)
            .map_err(|_| MlsError::protocol("encrypted upload URL validation"))?;
        if url.scheme() != "https" {
            return Err(MlsError::protocol("encrypted upload transport validation"));
        }
        Ok(target.url.clone())
    }
}

fn successful_response(
    response: reqwest::blocking::Response,
    operation: &str,
) -> Result<reqwest::blocking::Response, MlsError> {
    let status = response.status().as_u16();
    if response.status().is_success() {
        return Ok(response);
    }
    let fallback = match status {
        401 => "Sign in again, then reopen Whisp to resume this send.",
        403 => {
            "This account cannot complete this send. Check your device and conversation membership before retrying."
        }
        404 | 410 => {
            "This send's server record expired or is no longer available. Send the whisp again."
        }
        409 => "The conversation changed during this send. Whisp will sync and retry.",
        412 => {
            "This send needs updated encryption keys or membership. Open Whisp on the recipient devices, then retry."
        }
        400 | 413 | 422 => "The server rejected this upload. Capture and send the whisp again.",
        _ => {
            "The send service is temporarily unavailable. Whisp will retry; the queued whisp is preserved."
        }
    };
    // Only public, actionable 4xx messages are shown. Never persist raw HTTP
    // bodies, internal server errors, validation dumps, or signed upload URLs.
    let message = if matches!(status, 401 | 403 | 412) {
        let body: Value = serde_json::from_reader(response.take(4096)).unwrap_or(Value::Null);
        body.pointer("/error/json/message")
            .or_else(|| body.get("message"))
            .and_then(Value::as_str)
            .filter(|text| {
                !text.is_empty() && text.len() <= 512 && !text.chars().any(char::is_control)
            })
            .unwrap_or(fallback)
            .to_owned()
    } else {
        fallback.into()
    };
    Err(MlsError::Request {
        operation: operation.into(),
        status,
        recovery: message,
    })
}
