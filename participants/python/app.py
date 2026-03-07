from fastapi import FastAPI, Depends, HTTPException, Request, Response, status, Query
from pydantic import BaseModel
from conn import get_db
from model import UrlModel, ClickModel
from sqlalchemy.orm import Session
from utils import valid_url, generate_random_code, generate_qrcode_base64
from datetime import datetime

import qrcode


import logging

import pytz



logging.basicConfig(
    level=logging.INFO, # Set the minimum level to log (DEBUG, INFO, WARNING, ERROR, CRITICAL)
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', # Define the output format
    filename='myapp.log', # Log messages to a file
    filemode='a' # Append to the file (use 'w' to overwrite each run)
)

logger = logging.getLogger(__name__)


app = FastAPI()


class Url(BaseModel):
    url: str | None = None
    custom_code: str | None = None
    expires_at: str | None = None


@app.post("/urls")
async def create_urls(url: Url, response: Response, db: Session = Depends(get_db)):
    if not valid_url(url.url):
        response.status_code = 400
        return {"error": "url not valid"}

    if url.expires_at is not None:
        expires_at = str(url.expires_at)
        agora = datetime.now().astimezone()
        data_parseada = datetime.fromisoformat(expires_at).astimezone()
        if data_parseada < agora:
            response.status_code = 400
            return {"error": "url not valid"}

    urlmodel = db.query(UrlModel).filter_by(
        url=url.url
    ).first()
    if urlmodel is not None:
        response.status_code = 200
        return urlmodel


    urlmodel = db.query(UrlModel).filter_by(
        code=url.custom_code
    ).first()
    if urlmodel is not None:
        response.status_code = 409
        return urlmodel


    custom_code = url.custom_code
    if url.custom_code is not None and (len(url.custom_code) > 16 or len(url.custom_code) == 0):
        response.status_code = 400
        return {"error": "custom code is invalid"}

    is_custom_code_filled = custom_code is not None
    if not is_custom_code_filled:
        custom_code = generate_random_code()

    try:
        urlmodel = UrlModel(
            code=custom_code,
            url=url.url,
            expires_at=url.expires_at,
        )

        db.add(urlmodel)
        db.commit()
        db.refresh(urlmodel)

        response.status_code = status.HTTP_201_CREATED

        return_json = {
            "id": urlmodel.id,
            "code": urlmodel.code,
            "url": urlmodel.url,
            "expires_at": urlmodel.expires_at,
            "short_url": f"https://localhost:3000/{urlmodel.code}",
            "click_count": urlmodel.click_count,
            "created_at": "2026-01-01",
            "updated_at": "2026-01-01",
        }

        return return_json
    except Exception as _:
        db.rollback()

        if is_custom_code_filled:
            urlmodel = db.query(UrlModel).filter_by(
                code=custom_code
            ).first()

            # TODO: verificar a regra de expiração
            if urlmodel is not None and urlmodel.expires_at < datetime.now():
                response.status_code = 410
                return {"error": "url expirado"}

            response.status_code = 200
            return urlmodel
        else:
            urlmodel = db.query(UrlModel).filter_by(
                url=url.url
            ).first()
            response.status_code = 200
            return urlmodel



@app.patch("/urls/{id}")
async def patch_urls(id: str | None, url: Url, response: Response, db: Session = Depends(get_db)):
    if not valid_url(url.url):
        response.status_code = 400
        return {"error": "url not valid"}

    if url.expires_at is not None:
        expires_at = str(url.expires_at)
        agora = datetime.now().astimezone()
        data_parseada = datetime.fromisoformat(expires_at).astimezone()

        if data_parseada < agora:
            response.status_code = 409
            return {"error": "url not valid"}

    urlmodel = db.query(UrlModel).filter_by(id=id).first()

    if urlmodel is None:
        response.status_code = 404
        return {"error": "record not found"}

    try:
        if url.url is not None:
            urlmodel.url = url.url

        if url.expires_at is not None:
            urlmodel.expires_at = str(url.expires_at)

        db.add(urlmodel)
        db.commit()
        db.refresh(urlmodel)

        response.status_code = 200

        return_json = {
            "id": urlmodel.id,
            "code": urlmodel.code,
            "url": urlmodel.url,
            "expires_at": urlmodel.expires_at,
            "short_url": f"https://localhost:3000/{urlmodel.code}",
            "click_count": urlmodel.click_count,
            "created_at": "2026-01-01",
            "updated_at": "2026-01-01",
        }

        return return_json
    except Exception as _:
        db.rollback()
        response.status_code = 500
        return {"error": "ocorreu um erro ao salvar"}


@app.delete("/urls/{id}")
async def delete_urls(id: str | None, response: Response, db: Session = Depends(get_db)):
    urlmodel = db.get(UrlModel, id)

    if urlmodel == None:
        response.status_code = 404
        return {"error": "record not found"}

    try:
        db.delete(urlmodel)

        db.commit()

        response.status_code = 204

        return urlmodel
    except Exception as _:
        db.rollback()

        return



@app.get("/urls/{id}")
async def get_url(id: str | None, response: Response, db: Session = Depends(get_db)):
    urlmodel = db.get(UrlModel, id)

    if urlmodel == None:
        response.status_code = 404
        return {"error": "record not found"}

    return_json = {
        "id": urlmodel.id,
        "code": urlmodel.code,
        "url": urlmodel.url,
        "expires_at": urlmodel.expires_at,
        "short_url": f"https://localhost:3000/{urlmodel.code}",
        "click_count": urlmodel.click_count,
        "created_at": "2026-01-01",
        "updated_at": "2026-01-01",
    }

    return return_json


@app.get("/urls")
async def get_urls(request: Request, page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100), db: Session = Depends(get_db)):
    skip = (page - 1) * page_size

    items = db.query(UrlModel).offset(skip).limit(page_size).all()
    total_items = db.query(UrlModel).count()

    return {
        "data": items,
        "meta": { "page": page, "per_page": page_size, "total": total_items }
    }


@app.get("/{code}")
async def get_code(code: str, response: Response, db: Session = Depends(get_db)):
    urlmodel = db.query(UrlModel).filter_by(code=code).first()

    if urlmodel is None:
        response.status_code = 404
        return {"error": "not found"}

    if urlmodel.expires_at is not None:
        expires_at = str(urlmodel.expires_at)
        agora = datetime.now().astimezone()
        data_parseada = datetime.fromisoformat(expires_at).astimezone()

        if data_parseada < agora:
            response.status_code = 410
            return {"error": "expired"}

    try:
        urlmodel.click_count = int(urlmodel.click_count) + 1
        clickmodel = ClickModel(
            url_id=urlmodel.id,
            clicked_at=datetime.now().astimezone(),
        )
        db.add(clickmodel)
        db.commit()
    except Exception as _:
        response.status_code = 500
        return {"error": "error incrementing counter"}

    response.status_code = 301
    response.headers["location"] = urlmodel.url
    return {"location": urlmodel.url}


@app.get("/urls/{id}/stats")
async def get_code(id: str, response: Response, db: Session = Depends(get_db)):
    urlmodel = db.query(UrlModel).filter_by(id=id).first()

    if urlmodel is None:
        response.status_code = 404
        return {"error": "not found"}

    clickmodel = db.query(ClickModel).filter(ClickModel.url_id == urlmodel.id).all()

    clicks_per_day = {}
    clicks_per_hour = {}

    for click in clickmodel:
        day = click.clicked_at.strftime('%Y-%m-%d')
        hour = click.clicked_at.strftime('%Y-%m-%dT%H-00-00Z')

        clicks_per_day[day] = int(clicks_per_day.get(day, 0)) + 1
        clicks_per_hour[hour] = int(clicks_per_hour.get(hour, 0)) + 1

    return_json = {
        "id": urlmodel.id,
        "code": urlmodel.code,
        "url": urlmodel.url,
        "click_count": urlmodel.click_count,
        "clicks_per_day": [{"date": key, "count": value} for key, value in clicks_per_day.items()],
        "clicks_per_hour": [{"hour": key, "count": value} for key, value in clicks_per_hour.items()],
    }

    return return_json


@app.get("/urls/{id}/qr")
async def get_code(id: str, response: Response, db: Session = Depends(get_db)):
    urlmodel = db.query(UrlModel).filter_by(id=id).first()

    if urlmodel is None:
        response.status_code = 404
        return {"error": "not found"}

    return {"qr_code": generate_qrcode_base64(urlmodel.url)}



@app.get("/health")
async def health():
    return {"status": "ok"}
