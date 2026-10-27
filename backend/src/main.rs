use schema_explorer::{
    adapters::csv::{CsvInput, import_csv},
    analysis::context::{Intent, build_context},
    domain::ModelState,
    domain::{Operation, preview},
};
use std::{env, fs};

fn run() -> Result<serde_json::Value, String> {
    let args: Vec<_> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("import") if args.len() >= 2 => {
            let files: Vec<_> = args[1..].iter().map(|arg| {
                let (name, path) = arg.split_once('=').ok_or("Expected table-name=path.csv")?;
                Ok((name.to_owned(), fs::read_to_string(path).map_err(|e| e.to_string())?))
            }).collect::<Result<_, String>>()?;
            let inputs: Vec<_> = files.iter().map(|(name, contents)| CsvInput { table_name: name, contents }).collect();
            let timestamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
            serde_json::to_value(import_csv(&inputs, &format!("import_{timestamp}"))?).map_err(|e| e.to_string())
        },
        Some("context") if (2..=3).contains(&args.len()) => {
            let state: ModelState = serde_json::from_str(&fs::read_to_string(&args[1]).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let budget = args.get(2).map(|s| s.parse::<usize>()).transpose().map_err(|e| e.to_string())?.unwrap_or(16_384);
            serde_json::to_value(build_context(&state, Intent::default(), budget)?).map_err(|e| e.to_string())
        },
        Some("preview") if args.len() == 3 => {
            let state: ModelState = serde_json::from_str(&fs::read_to_string(&args[1]).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let plan: Vec<Operation> = serde_json::from_str(&fs::read_to_string(&args[2]).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            match preview(&state, &plan) {
                Ok(result) => serde_json::to_value(result).map_err(|e| e.to_string()),
                Err(error) => Err(serde_json::to_string_pretty(&error).map_err(|e| e.to_string())?),
            }
        },
        _ => Err("Usage:\n  schema-explorer import name=path.csv [name=path.csv ...]\n  schema-explorer context model.json [max-context-bytes]\n  schema-explorer preview model.json plan.json".into()),
    }
}

fn main() {
    match run() {
        Ok(value) => println!(
            "{}",
            serde_json::to_string_pretty(&value).expect("JSON value")
        ),
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(2);
        }
    }
}
