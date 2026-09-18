use crate::MlsError;
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::time::Duration;

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
            .map_err(|_| MlsError::protocol("send server request (retry when connected)"))?;
        if !response.status().is_success() {
            return Err(MlsError::Protocol {
                operation: format!(
                    "send server request {name} ({})",
                    response.status().as_u16()
                ),
                recovery: "The queued whisp is preserved. Open Whisp to sign in or retry.".into(),
            });
        }
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
            .send().and_then(|r| r.error_for_status()).map_err(|_| MlsError::protocol("encrypted upload authorization"))?;
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
