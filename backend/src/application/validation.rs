use crate::domain::{ConstraintChecker, ScanRequest, Schema, ValidationBatch};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

struct Run {
    checker: ConstraintChecker,
    touched: Instant,
}

#[derive(Serialize)]
pub struct StartedRun {
    pub id: String,
    pub scans: Vec<ScanRequest>,
}

/// Owns temporary validation resources. HTTP and other hosts share the same
/// limits, scan planning, expiry, failure cleanup, and completion semantics.
pub struct ValidationRuns {
    runs: BTreeMap<String, Run>,
    prefix: u128,
    next_id: u64,
}
impl Default for ValidationRuns {
    fn default() -> Self {
        Self {
            runs: BTreeMap::new(),
            prefix: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos(),
            next_id: 0,
        }
    }
}
impl ValidationRuns {
    pub fn start(
        &mut self,
        schema: Schema,
        counts: BTreeMap<String, usize>,
    ) -> Result<StartedRun, String> {
        self.expire();
        if self.runs.len() >= 2 {
            return Err("Another validation is running. Please retry shortly.".into());
        }
        let checker = ConstraintChecker::new(schema, counts)?;
        let scans = checker.scans();
        self.next_id += 1;
        let id = format!("{:x}-{}", self.prefix, self.next_id);
        self.runs.insert(
            id.clone(),
            Run {
                checker,
                touched: Instant::now(),
            },
        );
        Ok(StartedRun { id, scans })
    }
    pub fn push(&mut self, id: &str, batch: ValidationBatch) -> Result<(), String> {
        self.expire();
        let run = self
            .runs
            .get_mut(id)
            .ok_or("Validation expired. Preview this edit again.")?;
        match run.checker.push(batch) {
            Ok(()) => {
                run.touched = Instant::now();
                Ok(())
            }
            Err(error) => {
                self.runs.remove(id);
                Err(error)
            }
        }
    }
    pub fn finish(&mut self, id: &str) -> Result<(), String> {
        self.expire();
        self.runs
            .remove(id)
            .ok_or("Validation expired. Preview this edit again.")?
            .checker
            .finish()
    }
    pub fn cancel(&mut self, id: &str) {
        self.runs.remove(id);
    }
    pub fn expire(&mut self) {
        self.runs
            .retain(|_, run| run.touched.elapsed() < Duration::from_secs(300));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn empty() -> Schema {
        Schema {
            tables: vec![],
            foreign_keys: vec![],
        }
    }
    #[test]
    fn session_lifetime_and_capacity_are_transport_independent() {
        let mut runs = ValidationRuns::default();
        let a = runs.start(empty(), BTreeMap::new()).unwrap();
        let b = runs.start(empty(), BTreeMap::new()).unwrap();
        assert!(runs.start(empty(), BTreeMap::new()).is_err());
        runs.cancel(&a.id);
        let c = runs.start(empty(), BTreeMap::new()).unwrap();
        runs.runs.get_mut(&b.id).unwrap().touched = Instant::now() - Duration::from_secs(301);
        runs.expire();
        assert!(runs.finish(&b.id).is_err());
        runs.finish(&c.id).unwrap();
        assert!(runs.finish(&c.id).is_err());
    }
}
