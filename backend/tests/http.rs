#![cfg(feature = "server")]
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use schema_explorer::{
    adapters::csv::{CsvInput, import_csv},
    http::router,
};
use serde_json::{Value, json};
use tower::ServiceExt;

#[tokio::test]
async fn http_calls_the_same_rust_evaluator() {
    let state = import_csv(
        &[CsvInput {
            table_name: "source",
            contents: "a\n001\n",
        }],
        "revision-4",
    )
    .unwrap();
    let request = Request::builder().method("POST").uri("/api/operations/evaluate").header("content-type", "application/json")
        .body(Body::from(json!({"state": state, "operations":[{"op":"rename_table","table_id":"table_0","new_name":"renamed"}]}).to_string())).unwrap();
    let response = router("missing-static-directory".into())
        .oneshot(request)
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(
        &to_bytes(response.into_body(), 4 * 1024 * 1024)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(body["kind"], "valid");
    assert_eq!(
        body["preview"]["candidate"]["schema"]["tables"][0]["name"],
        "renamed"
    );
    assert_eq!(
        body["preview"]["candidate"]["data"]["table_0"][0]["cells"]["column_0_0"]["value"],
        "001"
    );
}

#[tokio::test]
async fn invalid_domains_return_structured_errors() {
    let state = import_csv(
        &[CsvInput {
            table_name: "source",
            contents: "a\n1\n",
        }],
        "v0",
    )
    .unwrap();
    let request = Request::builder().method("POST").uri("/api/operations/evaluate").header("content-type", "application/json")
        .body(Body::from(json!({"state":state,"operations":[{"op":"drop_column","table_id":"table_0","column_id":"missing"}]}).to_string())).unwrap();
    let response = router("missing".into()).oneshot(request).await.unwrap();
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body["kind"], "invalid");
    assert_eq!(body["error"]["code"], "unknown_target");
}

#[tokio::test]
async fn unknown_operations_are_not_accepted_as_commands() {
    let request = Request::builder().method("POST").uri("/api/operations/evaluate").header("content-type", "application/json")
        .body(Body::from(r#"{"state":{"version_id":"x","schema":{"tables":[]},"data":{}},"operations":[{"op":"change_type"}]}"#)).unwrap();
    assert_eq!(
        router("missing".into())
            .oneshot(request)
            .await
            .unwrap()
            .status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
}

#[tokio::test]
async fn oversized_requests_and_unknown_api_routes_are_rejected() {
    let request = Request::builder()
        .method("POST")
        .uri("/api/operations/evaluate")
        .header("content-type", "application/json")
        .body(Body::from(vec![b'x'; 4 * 1024 * 1024 + 1]))
        .unwrap();
    assert_eq!(
        router("missing".into())
            .oneshot(request)
            .await
            .unwrap()
            .status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let request = Request::builder()
        .uri("/api/unknown")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        router("missing".into())
            .oneshot(request)
            .await
            .unwrap()
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn validation_requires_complete_coverage_and_releases_failed_jobs() {
    let app = router("missing".into());
    let mut state = import_csv(
        &[CsvInput {
            table_name: "keys",
            contents: "id\na\nb\n",
        }],
        "v",
    )
    .unwrap();
    state.schema.tables[0].primary_key = vec!["column_0_0".into()];
    async fn post(app: &axum::Router, path: &str, body: Value) -> Value {
        let req = Request::builder()
            .method("POST")
            .uri(path)
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.clone().oneshot(req).await.unwrap();
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap()
    }
    let start = post(
        &app,
        "/api/constraints/start",
        json!({"schema":state.schema,"counts":{"table_0":2}}),
    )
    .await;
    let id = start["id"].as_str().unwrap();
    let batch = json!({"phase":"keys","table_id":"table_0","start":0,"rows":[{"column_0_0":{"type":"text","value":"a"}}]});
    assert_eq!(
        post(&app, &format!("/api/constraints/{id}/batch"), batch.clone()).await["kind"],
        "valid"
    );
    assert_eq!(
        post(&app, &format!("/api/constraints/{id}/finish"), json!({})).await["kind"],
        "invalid"
    );
    assert_eq!(
        post(&app, &format!("/api/constraints/{id}/batch"), batch).await["kind"],
        "invalid"
    );
    let next = post(
        &app,
        "/api/constraints/start",
        json!({"schema":state.schema,"counts":{"table_0":2}}),
    )
    .await;
    let id = next["id"].as_str().unwrap();
    let batch = json!({"phase":"keys","table_id":"table_0","start":0,"rows":[{"column_0_0":{"type":"text","value":"a"}},{"column_0_0":{"type":"text","value":"b"}}]});
    assert_eq!(
        post(&app, &format!("/api/constraints/{id}/batch"), batch).await["kind"],
        "valid"
    );
    assert_eq!(
        post(&app, &format!("/api/constraints/{id}/finish"), json!({})).await["kind"],
        "valid"
    );
}
