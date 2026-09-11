use aws_sdk_s3::Client;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

pub async fn scripted_endpoint(
    responses: Vec<String>,
) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for response in responses {
            let (mut socket, _) =
                tokio::time::timeout(std::time::Duration::from_secs(10), listener.accept())
                    .await
                    .unwrap()
                    .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                socket.read_exact(&mut byte).await.unwrap();
                request.push(byte[0]);
            }
            let headers = String::from_utf8(request).unwrap();
            let length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            let mut body = vec![0; length];
            socket.read_exact(&mut body).await.unwrap();
            requests.push(format!("{headers}{}", String::from_utf8_lossy(&body)));
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    });
    (endpoint, server)
}

pub async fn scripted_client(
    responses: Vec<String>,
) -> (Client, tokio::task::JoinHandle<Vec<String>>) {
    let (endpoint, server) = scripted_endpoint(responses).await;
    let config = aws_sdk_s3::config::Builder::new()
        .behavior_version_latest()
        .region(aws_sdk_s3::config::Region::new("us-east-1"))
        .credentials_provider(aws_sdk_s3::config::Credentials::new(
            "TEST",
            "test-secret",
            None,
            None,
            "test",
        ))
        .endpoint_url(endpoint)
        .force_path_style(true)
        .retry_config(aws_sdk_s3::config::retry::RetryConfig::standard().with_max_attempts(1))
        .build();
    (Client::from_conf(config), server)
}

pub fn response(status: u16, headers: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n{headers}\r\n{body}",
        body.len()
    )
}

pub async fn stalled_endpoint(
    response: &'static str,
) -> (
    String,
    tokio::sync::oneshot::Receiver<()>,
    tokio::task::JoinHandle<()>,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let (ready, received) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut byte = [0];
        while !request.ends_with(b"\r\n\r\n") {
            socket.read_exact(&mut byte).await.unwrap();
            request.push(byte[0]);
        }
        socket.write_all(response.as_bytes()).await.unwrap();
        let _ = ready.send(());
        std::future::pending::<()>().await;
        drop(socket);
    });
    (endpoint, received, server)
}
