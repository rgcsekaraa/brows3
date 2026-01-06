pub mod client;

pub use client::{S3ClientManager, BucketInfo, S3Object, list_buckets, get_bucket_region, format_size};
use std::sync::Arc;
use tokio::sync::RwLock;

pub type S3State = Arc<RwLock<S3ClientManager>>;
