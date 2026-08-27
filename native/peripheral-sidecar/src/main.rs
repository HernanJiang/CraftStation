use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{self, BufRead, Write};

const PROTOCOL_VERSION: u32 = 1;

#[derive(Deserialize)]
struct Request {
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    #[serde(rename = "requestId")]
    request_id: String,
    method: String,
}

#[derive(Serialize)]
struct Response<'a> {
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    #[serde(rename = "requestId")]
    request_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<Value>,
}

fn send(response: Response<'_>) {
    let mut stdout = io::stdout().lock();
    let _ = serde_json::to_writer(&mut stdout, &response);
    let _ = stdout.write_all(b"\n");
    let _ = stdout.flush();
}

fn main() {
    eprintln!("[craftstation-peripheral-sidecar] started protocolVersion={PROTOCOL_VERSION}");
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let request: Request = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                eprintln!("[craftstation-peripheral-sidecar] malformed request: {error}");
                continue;
            }
        };
        if request.protocol_version != PROTOCOL_VERSION {
            send(Response { protocol_version: PROTOCOL_VERSION, request_id: &request.request_id, result: None, error: Some(json!({"code":"PROTOCOL_MISMATCH","message":"Unsupported peripheral protocol version"})) });
            continue;
        }
        let response = match request.method.as_str() {
            "ping" => Response { protocol_version: PROTOCOL_VERSION, request_id: &request.request_id, result: Some(json!({"ready":true,"version":PROTOCOL_VERSION})), error: None },
            "version" => Response { protocol_version: PROTOCOL_VERSION, request_id: &request.request_id, result: Some(json!({"name":"craftstation-peripheral-sidecar","version":env!("CARGO_PKG_VERSION"),"protocolVersion":PROTOCOL_VERSION})), error: None },
            "shutdown" => { let response = Response { protocol_version: PROTOCOL_VERSION, request_id: &request.request_id, result: Some(json!({"stopped":true})), error: None }; send(response); break; },
            "usage.scan" | "usage.summary" => Response { protocol_version: PROTOCOL_VERSION, request_id: &request.request_id, result: Some(json!({"available":false,"unavailableReason":"Tokscale scanner is not bundled in this build"})), error: None },
            _ => Response { protocol_version: PROTOCOL_VERSION, request_id: &request.request_id, result: None, error: Some(json!({"code":"METHOD_UNSUPPORTED","message":"Peripheral method is unsupported"})) },
        };
        send(response);
    }
    eprintln!("[craftstation-peripheral-sidecar] stopped");
}
