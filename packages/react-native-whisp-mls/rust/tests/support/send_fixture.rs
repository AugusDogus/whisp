use serde_json::{Value, json};
use std::fs;
use whisp_mls::*;

pub struct Fixture {
    pub root: std::path::PathBuf,
    pub config: String,
    pub id: String,
    pub device: String,
}
impl Fixture {
    pub fn new(base: &str) -> Self {
        let root = std::env::temp_dir().join(new_id());
        fs::create_dir_all(root.join("conversations")).unwrap();
        fs::create_dir_all(root.join("packages")).unwrap();
        let device = new_id();
        let key = generate_storage_key();
        let client = MlsClient::new(device.clone()).unwrap();
        fs::write(
            root.join("device.json"),
            json!({"deviceId":device}).to_string(),
        )
        .unwrap();
        fs::write(
            root.join("identity.age"),
            encode_base64(client.export_state(key.clone()).unwrap()),
        )
        .unwrap();
        fs::write(root.join("capture"), b"private capture").unwrap();
        let config = json!({"root":root,"userId":"alice","deviceId":device,"storageKey":key,"cookie":"session=test","baseUrl":base,"uploadthingVersion":"7.7.4"}).to_string();
        Self {
            root,
            config,
            id: new_id(),
            device,
        }
    }
    pub fn enqueue(&self) {
        enqueue_send_job(self.config.clone(), json!({"id":self.id,"deviceId":self.device,"source":self.root.join("capture"),"kind":"photo","recipients":["bob"],"groupId":null}).to_string()).unwrap();
    }
    pub fn advance(&self) -> Value {
        serde_json::to_value(advance_send_job(self.config.clone(), self.id.clone()).unwrap())
            .unwrap()
    }
    pub fn dir(&self) -> std::path::PathBuf {
        self.root.join("sends").join(&self.id)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
        let _ = fs::remove_file(format!("{}.lock", self.root.display()));
    }
}

pub fn replace_phase(f: &Fixture, phase: Value, created_at: u64) {
    let config: Value = serde_json::from_str(&f.config).unwrap();
    let key = config["storageKey"].as_str().unwrap().to_owned();
    let path = f.dir().join("job.age");
    let mut job: Value = serde_json::from_str(
        &open_local(
            decode_base64(fs::read_to_string(&path).unwrap()).unwrap(),
            key.clone(),
        )
        .unwrap(),
    )
    .unwrap();
    job["phase"] = phase;
    job["createdAt"] = json!(created_at);
    fs::write(
        path,
        encode_base64(seal_local(job.to_string(), key).unwrap()),
    )
    .unwrap();
}
