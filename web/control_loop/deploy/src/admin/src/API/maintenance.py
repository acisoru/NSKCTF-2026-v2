import logging

from fastapi import APIRouter, HTTPException, Request

from src.API.functions import OBSERVER_STATUS, OPERATOR_STATUS, check_token, generate_pass_token, get_internal_user

logger = logging.getLogger(__name__)
router = APIRouter()

TOKEN_REQUIRED = "maintenance token required (see /admin/config)"

REQUESTS = [
    {
        "request_id": 1012,
        "requested_by": "dr_demon",
        "room": "архив",
        "status": "rejected",
        "note": "заявка подана 2017-11-02",
    },
    {
        "request_id": 1013,
        "requested_by": "mr_fade",
        "room": "склад",
        "status": "rejected",
        "note": "заявка подана 2018-01-14",
    },
    {
        "request_id": 1027,
        "requested_by": "mr_s",
        "room": "наблюдательная",
        "status": "pending",
        "note": "заявка на продление допуска",
    },
    {
        "request_id": 1035,
        "requested_by": "oper_2011",
        "room": "серверная",
        "status": "closed",
        "note": "заявка из старого контура, до миграции",
    },
    {
        "request_id": 1041,
        "requested_by": "oper_2018",
        "room": "серверная",
        "status": "approved",
        "note": "заявка подана перед инцидентом",
    },
]

PUBLIC_REQUEST_FIELDS = ("request_id", "requested_by", "room", "note")


@router.get("/admin/maintenance")
async def maintenance_root():
    return {"service": "регламентный контур", "status": "active"}


@router.get("/admin/maintenance/ping")
async def maintenance_ping():
    return {"status": "pong"}


@router.get("/admin/maintenance/status")
async def maintenance_status():
    return {"queue_depth": 0, "last_cycle": "2018-11-14T03:00:00"}


@router.get("/admin/maintenance/health")
async def maintenance_health():
    return {"status": "healthy"}


@router.get("/admin/maintenance/jobs")
async def maintenance_jobs():
    raise HTTPException(status_code=403, detail="список задач доступен только из планировщика")


@router.get("/admin/maintenance/requests")
async def maintenance_requests(request: Request):
    if not check_token(request):
        raise HTTPException(status_code=403, detail=TOKEN_REQUIRED)
    public_requests = [{k: r[k] for k in PUBLIC_REQUEST_FIELDS} for r in REQUESTS]
    return {"requests": public_requests}


@router.api_route("/admin/maintenance/issue", methods=["GET", "POST"])
async def maintenance_issue(request: Request):
    if not check_token(request):
        raise HTTPException(status_code=403, detail=TOKEN_REQUIRED)

    if request.method == "POST":
        try:
            form = await request.form()
        except Exception:
            form = {}
        raw_request_id = form.get("request_id") or request.query_params.get("request_id")
    else:
        raw_request_id = request.query_params.get("request_id")

    try:
        request_id = int(raw_request_id)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="request_id is required")

    matched = next((r for r in REQUESTS if r["request_id"] == request_id), None)
    if matched is None:
        raise HTTPException(status_code=404, detail="request not found")
    if matched["status"] == "rejected":
        raise HTTPException(status_code=403, detail="request is not approved")

    status_claim = OPERATOR_STATUS if matched["status"] == "approved" else OBSERVER_STATUS
    pass_token = generate_pass_token(request_id, matched["requested_by"], status_claim)
    logger.info(f"Pass issued {request_id=} {status_claim=}")

    response = {"status": "issued", "token": pass_token}
    if get_internal_user(request):
        response["identity"] = "accepted"
    return response
