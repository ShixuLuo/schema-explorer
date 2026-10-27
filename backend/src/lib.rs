//! Model evolution and SQL generation; the HTTP server is an optional adapter.
pub mod adapters;
pub mod analysis;
pub mod application;
pub mod domain;
#[cfg(feature = "server")]
pub mod http;
pub mod migration;
