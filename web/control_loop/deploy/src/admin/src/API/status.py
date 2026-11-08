import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

from src.API.functions import MAINTENANCE_HEADER, MAINTENANCE_TOKEN

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/")
async def root():
    raise HTTPException(status_code=403, detail="контур управления, доступ по служебному пути")


@router.get("/status")
async def status():
    return {
        "service": "control-loop-admin",
        "status": "ok",
        "note": "регламентный контур, подъём по расписанию",
    }


@router.get("/health")
async def health():
    return {"status": "healthy", "checks_passed": 12, "checks_total": 12}


@router.get("/version")
async def version():
    return {"build": "2018.11-r4", "runtime": "internal"}


@router.get("/debug")
async def debug():
    raise HTTPException(status_code=403, detail="отладочный режим отключён в этой сборке")


@router.get("/private")
async def private():
    raise HTTPException(status_code=403, detail="раздел только для служебных учётных записей")


@router.get("/docs")
async def docs():
    return {
        "service": "LabXControlTerminal (public)",
        "routes": {
            "GET /": "форма входа / регистрации наблюдателя",
            "GET /cards": "список карточек аномалий пользователя",
            "POST /cards/create": "создание карточки аномалии",
            "GET /registry": "реестр личного состава",
            "GET /registry/entry": "запись реестра по id",
        },
    }


@router.get("/admin")
async def admin_root():
    return {
        "service": "регламентный контур",
        "note": "часть процедур переведена в регламентный контур обслуживания",
    }


@router.get("/admin/health")
async def admin_health():
    return {"status": "healthy", "subsystems": ["scheduler", "notifier", "archiver"]}


@router.get("/admin/cache")
async def admin_cache():
    return {"entries": 4821, "hit_rate": 0.87, "evictions_last_hour": 14}


@router.get("/admin/queue")
async def admin_queue():
    return {"pending": 0, "processed_today": 231, "failed_today": 2}


@router.get("/admin/jobs")
async def admin_jobs():
    return {"scheduled": ["archive-rotate", "metrics-flush", "cert-renew"], "last_run": "2018-11-14T03:00:00"}


@router.get("/admin/backup")
async def admin_backup():
    raise HTTPException(status_code=403, detail="резервное копирование недоступно вне окна обслуживания")


@router.get("/admin/debug")
async def admin_debug():
    raise HTTPException(status_code=403, detail="отладочный интерфейс отключён на проде")


def _metrics_block(prefix: str, names: list[str], count: int) -> list[str]:
    lines = []
    for i in range(1, count + 1):
        name = names[(i - 1) % len(names)]
        lines.append(f'{prefix}_{name}{{shard="{i % 12}"}} {(i * 37) % 9973}')
    return lines


@router.get("/admin/metrics", response_class=PlainTextResponse)
async def admin_metrics():
    lines: list[str] = []

    lines += _metrics_block("cache", ["hits_total", "misses_total", "evictions_total"], 55)
    lines += _metrics_block("db_pool", ["wait_seconds_bucket", "active_connections", "idle_connections"], 55)
    lines += [f"gc_collections_total{{generation=\"{i % 3}\"}} {i * 3}" for i in range(1, 16)]
    lines += [f'http_requests_total{{path="/legacy/{i}"}} {i * 7 % 500}' for i in range(1, 16)]

    lines.append("maintenance_checks_total 884")
    lines.append("maintenance_last_rotation_seconds 1200")
    lines.append(f'maintenance_token_rotated{{value="{MAINTENANCE_TOKEN}"}} 1')

    lines += _metrics_block("network", ["bytes_sent_total", "bytes_recv_total", "retransmits_total"], 150)
    lines += [f"process_cpu_seconds_total {184221 + i}" for i in range(1, 11)]
    lines += _metrics_block("queue", ["depth", "enqueued_total", "dequeued_total"], 150)
    lines += [f'request_latency_bucket{{le="{i}"}} {i * 11 % 4001}' for i in range(1, 401)]
    lines += _metrics_block("thread_pool", ["active", "idle", "rejected_total"], 100)

    return PlainTextResponse("\n".join(lines))


@router.get("/admin/config")
async def admin_config():
    return {
        "service": "control-loop-admin",
        "version": "2018.11-r4",
        "maintenance_header": MAINTENANCE_HEADER,
        "log_level": "warning",
        "retention_days": 30,
    }


@router.get("/admin/logs")
async def admin_logs():
    raise HTTPException(status_code=403, detail="журнал доступен только через централизованный сбор логов")
