use crate::domain::{ModelState, Operation, PlanError, Preview, preview, preview_batch};
use crate::{
    application::validation::ValidationRuns,
    domain::Schema,
    domain::ValidationBatch as Batch,
    migration::{self, postgres::Postgres},
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, State},
    http::StatusCode,
    routing::{get, post},
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tower_http::services::{ServeDir, ServeFile};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EvaluationRequest {
    pub state: ModelState,
    pub operations: Vec<Operation>,
    #[serde(default)]
    pub batch: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum EvaluationResponse {
    Valid { preview: Preview },
    Invalid { error: PlanError },
}

async fn evaluate(
    Json(request): Json<EvaluationRequest>,
) -> Result<Json<EvaluationResponse>, StatusCode> {
    tokio::task::spawn_blocking(move || {
        match if request.batch {
            preview_batch(&request.state, &request.operations)
        } else {
            preview(&request.state, &request.operations)
        } {
            Ok(preview) => Json(EvaluationResponse::Valid { preview }),
            Err(error) => Json(EvaluationResponse::Invalid { error }),
        }
    })
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

pub fn router(web: PathBuf) -> Router {
    let api = Router::new()
        .route("/constraints/start", post(start_check))
        .route("/constraints/{id}/batch", post(check_batch))
        .route("/constraints/{id}/finish", post(finish_check))
        .route("/constraints/{id}", axum::routing::delete(cancel_check))
        .route(
            "/migration/sql",
            post(migration_sql).layer(DefaultBodyLimit::max(16 * 1024 * 1024)),
        )
        .route(
            "/health",
            get(|| async { Json(json!({"status":"ok", "llm":"disabled"})) }),
        )
        .route("/operations/evaluate", post(evaluate))
        .fallback(|| async {
            (
                StatusCode::NOT_FOUND,
                Json(json!({"error":"Unknown API route"})),
            )
        })
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
        .with_state(checks_state());
    Router::new().nest("/api", api).fallback_service(
        ServeDir::new(&web).not_found_service(ServeFile::new(web.join("index.html"))),
    )
}

type Checks = Arc<Mutex<ValidationRuns>>;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CheckStart {
    schema: Schema,
    counts: BTreeMap<String, usize>,
}
fn check_error(message: impl ToString) -> Json<serde_json::Value> {
    Json(json!({"kind":"invalid","error":{"message":message.to_string()}}))
}
async fn start_check(
    State(checks): State<Checks>,
    Json(input): Json<CheckStart>,
) -> Json<serde_json::Value> {
    match checks.lock().unwrap().start(input.schema, input.counts) {
        Ok(run) => Json(json!({"kind":"valid","id":run.id,"scans":run.scans})),
        Err(error) => check_error(error),
    }
}
async fn check_batch(
    State(checks): State<Checks>,
    Path(id): Path<String>,
    Json(batch): Json<Batch>,
) -> Json<serde_json::Value> {
    match checks.lock().unwrap().push(&id, batch) {
        Ok(()) => Json(json!({"kind":"valid"})),
        Err(error) => check_error(error),
    }
}
async fn finish_check(
    State(checks): State<Checks>,
    Path(id): Path<String>,
) -> Json<serde_json::Value> {
    match checks.lock().unwrap().finish(&id) {
        Ok(()) => Json(json!({"kind":"valid"})),
        Err(error) => check_error(error),
    }
}
async fn cancel_check(State(checks): State<Checks>, Path(id): Path<String>) -> StatusCode {
    checks.lock().unwrap().cancel(&id);
    StatusCode::NO_CONTENT
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MigrationRequest {
    base: Schema,
    operations: Vec<Operation>,
    current: Schema,
}
async fn migration_sql(Json(input): Json<MigrationRequest>) -> Json<serde_json::Value> {
    match migration::generate(&input.base, &input.operations, &input.current, &Postgres) {
        Ok(sql) => Json(json!({"kind":"valid","sql":sql})),
        Err(e) => check_error(e),
    }
}

fn checks_state() -> Checks {
    let checks = Arc::new(Mutex::new(ValidationRuns::default()));
    let weak = Arc::downgrade(&checks);
    if let Ok(runtime) = tokio::runtime::Handle::try_current() {
        runtime.spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                let Some(checks) = weak.upgrade() else {
                    break;
                };
                checks.lock().unwrap().expire();
            }
        });
    }
    checks
}
