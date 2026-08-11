"""POST /clients/{id}/chat, GET/DELETE /clients/{id}/chat-history,
POST /clients/{id}/chat/{message_id}/flag-for-report,
GET /clients/{id}/chat/flagged — the AI Chat panel.

POST /clients/{id}/chat streams newline-delimited JSON (one JSON object per
line) rather than a single response body, so the frontend can show live
progress ("Checking {tool}...") while a Verified-mode tool-calling turn is
actually in flight, instead of a generic spinner. See services/chat_service.py
for the real tool-calling loop / exploratory-context logic this only
orchestrates.
"""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services import chat_service
from services.client_store import ClientNotFoundError, load_client

router = APIRouter()


class ChatRequest(BaseModel):
    message: str
    mode: Literal["verified", "exploratory"]


@router.post("/clients/{client_id}/chat")
def chat(client_id: str, request: ChatRequest) -> StreamingResponse:
    try:
        load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    if not request.message.strip():
        raise HTTPException(status_code=422, detail="Message is required.")

    return StreamingResponse(
        chat_service.stream_chat_turn(client_id, request.message.strip(), request.mode),
        media_type="application/x-ndjson",
    )


@router.get("/clients/{client_id}/chat-history")
def get_chat_history(client_id: str) -> dict:
    try:
        load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return chat_service.load_history(client_id)


@router.delete("/clients/{client_id}/chat-history")
def delete_chat_history(client_id: str) -> dict:
    try:
        load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    chat_service.clear_history(client_id)
    return {"client_id": client_id, "cleared": True}


@router.post("/clients/{client_id}/chat/{message_id}/flag-for-report")
def flag_message_for_report(client_id: str, message_id: str) -> dict:
    try:
        load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    try:
        return chat_service.flag_message_for_report(client_id, message_id)
    except chat_service.ChatMessageNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/clients/{client_id}/chat/flagged")
def get_flagged_messages(client_id: str) -> dict:
    """Every flagged Exploratory-mode message for this client, retrievable
    entirely on its own — this has no connection to report generation
    (routers/reports.py) and doesn't require ever generating a report to
    use."""
    try:
        load_client(client_id)
    except ClientNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return {"client_id": client_id, "flagged_messages": chat_service.get_flagged_messages(client_id)}
