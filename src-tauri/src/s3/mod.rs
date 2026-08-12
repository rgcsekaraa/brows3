pub mod client;
pub mod content_type;
pub mod multipart;

pub use client::{
    format_size, get_bucket_region, list_buckets, BucketInfo, FolderContent, S3ClientManager,
    S3Object,
};
pub use content_type::{infer_content_type, validate_content_type};
pub use multipart::{
    plan_multipart_upload, MultipartPart, MultipartPlan, MultipartUploadGuard,
    MULTIPART_UPLOAD_THRESHOLD,
};
use std::sync::Arc;
use tokio::sync::RwLock;

pub type S3State = Arc<RwLock<S3ClientManager>>;
