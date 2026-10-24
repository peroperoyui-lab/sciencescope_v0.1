// Native settings use the host's public API, preserving normal workspace history
// and patch semantics instead of racing its settings file writer.
use crate::HostAccess;
use serde_json::Value;
use std::{
    io::{Read, Write},
    net::TcpStream,
    time::Duration,
};

pub fn settings(access: &HostAccess, changes: Option<Value>) -> Result<Value, String> {
    let host = access.url.host_str().ok_or("Host address is unavailable")?;
    let port = access.url.port().ok_or("Host port is unavailable")?;
    let mut stream = TcpStream::connect_timeout(
        &format!("{host}:{port}")
            .parse()
            .map_err(|_| "Invalid host address")?,
        Duration::from_secs(5),
    )
    .map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(10)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let method = if changes.is_some() { "PATCH" } else { "GET" };
    let body = changes.map(|value| value.to_string()).unwrap_or_default();
    let request = format!(
        "{method} /api/settings HTTP/1.1\r\nHost: {host}:{port}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        access.api_token, body.len(),
    );
    stream
        .write_all(request.as_bytes())
        .map_err(|error| error.to_string())?;
    let mut response = Vec::new();
    stream
        .read_to_end(&mut response)
        .map_err(|error| error.to_string())?;
    parse_response(&response)
}

fn parse_response(response: &[u8]) -> Result<Value, String> {
    let split = response
        .windows(4)
        .position(|bytes| bytes == b"\r\n\r\n")
        .ok_or("Host returned an incomplete response")?;
    let headers = std::str::from_utf8(&response[..split]).map_err(|error| error.to_string())?;
    if headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        != Some("200")
    {
        return Err("Host settings request failed".into());
    }
    let body = &response[split + 4..];
    let decoded;
    let body = if headers
        .lines()
        .any(|line| line.eq_ignore_ascii_case("transfer-encoding: chunked"))
    {
        decoded = decode_chunks(body)?;
        decoded.as_slice()
    } else {
        body
    };
    serde_json::from_slice(body).map_err(|error| error.to_string())
}

fn decode_chunks(mut input: &[u8]) -> Result<Vec<u8>, String> {
    let mut body = Vec::new();
    loop {
        let end = input
            .windows(2)
            .position(|bytes| bytes == b"\r\n")
            .ok_or("Invalid host chunk")?;
        let size = std::str::from_utf8(&input[..end]).map_err(|error| error.to_string())?;
        let size = usize::from_str_radix(size.split(';').next().unwrap_or(""), 16)
            .map_err(|error| error.to_string())?;
        input = &input[end + 2..];
        if size == 0 {
            return Ok(body);
        }
        if input.len() < size + 2 || &input[size..size + 2] != b"\r\n" {
            return Err("Incomplete host chunk".into());
        }
        body.extend_from_slice(&input[..size]);
        input = &input[size + 2..];
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn reads_node_chunked_settings_response() {
        let response = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n{\"a\":1\r\n1\r\n}\r\n0\r\n\r\n";
        assert_eq!(
            super::parse_response(response).unwrap(),
            serde_json::json!({"a": 1})
        );
    }
}
