import importlib


def test_pdf_slide_payload_preserves_ocr_backend_and_text_boxes(tmp_path, monkeypatch):
    import app.main as main

    mod = importlib.reload(main)
    mod.data_dir = tmp_path / "data"
    mod.data_dir.mkdir(parents=True, exist_ok=True)

    class DummyIngestion:
        async def ingest_pdf(self, _file_path):
            from app.services.document_ingestion import (
                DeckContent,
                SlideContent,
                TextBox,
            )

            deck = DeckContent(file_path="dummy.pdf")
            slide = SlideContent(
                slide_index=0,
                title="Page 1 (OCR)",
                width=10.0,
                height=7.5,
                ocr_backend="surya",
            )
            slide.text_boxes.append(
                TextBox(
                    id="tb_page_0_ocr_0",
                    text="Revenue grew 12%",
                    x=1.0,
                    y=1.0,
                    width=4.0,
                    height=0.8,
                )
            )
            deck.slides.append(slide)
            deck.metadata = {"slide_count": 1}
            return deck

        async def convert_pdf_to_images(self, _file_path, output_dir, dpi=150):
            (tmp_path / "dummy.png").write_bytes(b"PNG")
            return [str(tmp_path / "dummy.png")]

    mod.ingestion_service = DummyIngestion()

    async def _noop_previews(deck_path, upload_dir):
        return None

    monkeypatch.setattr(mod, "ensure_services_loaded", lambda: None)
    monkeypatch.setattr(mod, "_generate_previews_for_deck", _noop_previews)

    sid = "s1"
    uploads_dir = mod.data_dir / "uploads" / sid
    uploads_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = uploads_dir / "deck.pdf"
    pdf_path.write_bytes(b"%PDF")

    mod.active_sessions[sid] = {
        "deck_path": str(pdf_path),
        "slides_data": [],
        "status": "uploaded",
        "created_at_ts": 0,
        "last_access_ts": 0,
    }
    mod.session_store.save(sid, mod.active_sessions[sid])

    import asyncio

    result = asyncio.run(mod.analyze_deck(sid))
    assert result["status"] == "parsed"

    slide_payload = mod.active_sessions[sid]["slides_data"][0]
    assert slide_payload["ocr_backend"] == "surya"
    assert len(slide_payload["text_boxes"]) == 1
    assert slide_payload["text_boxes"][0]["id"].startswith("tb_page_0_ocr_")
    persisted = mod.session_store.load(sid)
    assert persisted is not None
    assert persisted.get("status") == "parsed"


def test_annotation_mapping_uses_title_proxy_and_is_deterministic():
    import app.main as main

    slide = {
        "title": "Growth Strategy",
        "text_boxes": [
            {
                "id": "shape_7",
                "text": "Body text",
                "x": 1.0,
                "y": 2.0,
                "width": 6.0,
                "height": 2.0,
            }
        ],
        "charts": [],
        "tables": [],
        "images": [],
        "width": 10.0,
        "height": 7.5,
    }

    title_ann = {
        "text": "Growth Strategy",
        "category": "quality",
        "message": "Title issue",
    }
    box = main._annotation_to_bounding_box(title_ann, slide)
    assert 0 <= box["top"] <= 20
    assert box["left"] >= 0

    unknown_ann = {
        "text": "some unknown fragment",
        "category": "quality",
        "message": "Unknown",
    }
    box1 = main._annotation_to_bounding_box(unknown_ann, slide)
    box2 = main._annotation_to_bounding_box(unknown_ann, slide)
    assert box1 == box2
