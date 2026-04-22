# SlideForge AI - Internal Architecture

This document outlines the end-to-end processing pipeline and component interactions for the SlideForge AI document intelligence system.

## High-Level Pipeline

```mermaid
graph TD
    Client[Frontend Client (React/Next.js)]
    
    subgraph FastAPI Backend
        API[API Router (main.py)]
        SessionMgr[Session Management]
        
        subgraph Document Ingestion
            DocService[Document Ingestion Service]
            PDFPlumber[PDF Extraction]
            PPTX[python-pptx]
            SuryaLayout[Surya Layout Detection]
        end
        
        subgraph Parallel Agent Analysis
            Orchestrator[Analysis Orchestrator]
            Agent1[Insight Extractor]
            Agent2[Structure Auditor]
            Agent3[Data Lineage Agent]
            Agent4[Visual Analysis Agent]
            
            subgraph Tools & Services
                VisionService[Multimodal Vision Service]
                GuardrailManager[Guardrail Manager]
                ChromaDB[(ChromaDB - Claims Evidence)]
            end
            
            subgraph Local Inference API
                LMStudio[LM Studio Endpoint]
                LocalLLM[(Qwen 3.5-9B Vision)]
            end
        end
        
        subgraph QA & Grading
            QAGrader[QA Grading Orchestrator]
            ScorecardGen[Scorecard Generator]
        end
    end

    Client -- Uploads Document --> API
    API --> SessionMgr
    SessionMgr --> DocService
    
    DocService -- Extracts Text, Tables, Images, Coordinates --> Orchestrator
    
    Orchestrator --> Agent1
    Orchestrator --> Agent2
    Orchestrator --> Agent3
    Orchestrator --> Agent4
    
    Agent1 -- Evaluates rules against text & applies threshold --> LocalLLM
    Agent2 -- Analyzes narrative flow --> LocalLLM
    Agent3 -- Queries ChromaDB for Evidence --> ChromaDB
    Agent4 -- Analyzes Visuals & Coordinates --> VisionService
    
    VisionService -- Sends Base64 Image + Prompt --> LMStudio
    LMStudio -- Forward --> LocalLLM
    
    Agent1 & Agent2 & Agent3 & Agent4 -- Extracted Annotations --> QAGrader
    QAGrader -- Aggregates and Scores --> ScorecardGen
    ScorecardGen -- Returns Scorecard & Slides Data --> API
    
    API -- Analysis Results & Coords --> Client
    
    Client -- Renders Document & Highlights --> UserOverlay[Interactive Overlay Canvas]
```

## Functional Deep Dive

### 1. Document Ingestion (`document_ingestion.py`)
- **PDF Processing**: Uses `pdfplumber` for text and table extraction. Surya Layout model captures structural elements and their bounding boxes. Extracts embedded images.
- **PPTX Processing**: Uses `python-pptx` to parse Slide structure, shape relationships, table extraction, and image extraction.
- **Coordinate Normalization**: All bounding boxes are converted to percentage-based coordinates (`top`, `left`, `width`, `height`) for resolution-independent rendering on the frontend.

### 2. Multi-Agent Analysis (`parallel_analysis.py`)
Executes concurrently for optimal speed:
- **Insight Extractor**: Applies playbook rules (guardrails) to slide text. Configured to enforce high standards (pass thresholds vs fail blocks).
- **Structure Auditor**: Checks narrative flow, logical consistency, framework adherence (SWOT, MECE, etc.), and readability limits.
- **Data Lineage**: Validates numeric claims against uploaded source documents using `ClaimEvidenceGuardrail` initialized via ChromaDB.
- **Visual Analysis**: Leverages `surya` for dense visually-aware reading order and passes images to the vision agent.

### 3. Vision Pipeline (`vision.py`)
- Standardized on LM Studio's multimodal endpoint (`/v1/chat/completions`).
- Encodes images directly from extracted document payloads as Base64.
- Identifies chart types, reads chart data, checks imagery relevance to slide context, and catches visual inconsistencies.

### 4. Inference & Reliability (`llm_inference.py`)
- Connects to LM Studio (`http://localhost:1234/v1`).
- Contains defensive response parsing: stripping `<think>...</think>` artifacts dynamically.
- Built-in retry logic with exponential backoff handles LLM hallucinations and malformed JSON payloads.

### 5. Frontend Overlay Subsystem (`SlideCanvas.tsx`)
- Coordinates retrieved from document ingestion are passed alongside annotations in the scorecard.
- Employs a bidirectional linkage mechanism: highlighting issues in the UI maps direct glowing polygons to the original document regions.
