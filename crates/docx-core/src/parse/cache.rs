use std::sync::{
    mpsc::{sync_channel, SyncSender},
    Arc, OnceLock,
};

use arc_swap::ArcSwap;

type Update = Box<dyn FnOnce() + Send>;

fn writer() -> Option<&'static SyncSender<Update>> {
    static WRITER: OnceLock<Option<SyncSender<Update>>> = OnceLock::new();
    WRITER
        .get_or_init(|| {
            let (send, receive) = sync_channel::<Update>(8);
            std::thread::Builder::new()
                .name("docx-cache".into())
                .spawn(move || {
                    while let Ok(update) = receive.recv() {
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(update));
                    }
                })
                .ok()?;
            Some(send)
        })
        .as_ref()
}

pub(super) struct Snapshot<T> {
    value: ArcSwap<T>,
}

impl<T: Send + Sync + 'static> Snapshot<T> {
    pub(super) fn new(value: T) -> Self {
        Self {
            value: ArcSwap::from_pointee(value),
        }
    }

    pub(super) fn read<R>(&self, read: impl FnOnce(&T) -> R) -> R {
        read(&self.value.load())
    }

    pub(super) fn reader(&'static self) -> arc_swap::cache::Cache<&'static ArcSwap<T>, Arc<T>> {
        arc_swap::cache::Cache::new(&self.value)
    }

    pub(super) fn publish(&'static self, update: impl FnOnce(&T) -> T + Send + 'static) -> bool {
        let Some(writer) = writer() else { return false };
        writer
            .try_send(Box::new(move || {
                let next = update(&self.value.load());
                self.value.store(Arc::new(next));
            }))
            .is_ok()
    }

    pub(super) fn update<R: Send + 'static>(
        &'static self,
        update: impl FnOnce(&T) -> (T, R) + Send + 'static,
    ) -> Option<R> {
        let writer = writer()?;
        let (send, receive) = sync_channel(1);
        writer
            .send(Box::new(move || {
                let (next, result) = update(&self.value.load());
                self.value.store(Arc::new(next));
                let _ = send.send(result);
            }))
            .ok()?;
        receive.recv().ok()
    }
}
