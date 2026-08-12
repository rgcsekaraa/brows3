pub mod client;

pub use client::{
    format_size, get_bucket_region, list_buckets, BucketInfo, FolderContent, S3ClientManager,
    S3Object,
};
use std::sync::Arc;
use tokio::sync::RwLock;

pub type S3State = Arc<RwLock<S3ClientManager>>;
