const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak,
  TableOfContents, TabStopType, TabStopPosition,
} = require("docx");

// ── Design tokens ──
const COLOR = {
  primary: "1B3A5C",    // Dark navy
  accent: "2E75B6",     // Blue accent
  heading2: "1F4E79",   // Darker blue for H2
  light: "D9E6F2",      // Light blue shading
  medium: "B4D0E7",     // Medium blue
  white: "FFFFFF",
  black: "000000",
  gray: "666666",
  lightGray: "F2F2F2",
  border: "AAAAAA",
  green: "2E7D32",
  orange: "E65100",
  red: "C62828",
};

const FONT = { main: "Calibri", mono: "Consolas" };
const PAGE_W = 12240; // US Letter
const PAGE_H = 15840;
const MARGIN = 1440;  // 1 inch
const CONTENT_W = PAGE_W - 2 * MARGIN; // 9360

const border = { style: BorderStyle.SINGLE, size: 1, color: COLOR.border };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

// ── Helpers ──
function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 200 },
    children: [new TextRun({ text, font: FONT.main, size: 32, bold: true, color: COLOR.primary })],
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 160 },
    children: [new TextRun({ text, font: FONT.main, size: 26, bold: true, color: COLOR.heading2 })],
  });
}

function heading3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT.main, size: 24, bold: true, color: COLOR.accent })],
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120 },
    ...opts.paraOpts,
    children: [new TextRun({ text, font: FONT.main, size: 22, color: COLOR.black, ...opts.runOpts })],
  });
}

function boldPara(label, text) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: label, font: FONT.main, size: 22, bold: true, color: COLOR.black }),
      new TextRun({ text, font: FONT.main, size: 22, color: COLOR.black }),
    ],
  });
}

function bulletList(items, ref = "bullets") {
  return items.map(item => new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80 },
    children: Array.isArray(item)
      ? item
      : [new TextRun({ text: item, font: FONT.main, size: 22, color: COLOR.black })],
  }));
}

function subBulletList(items, ref = "subBullets") {
  return items.map(item => new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text: item, font: FONT.main, size: 20, color: COLOR.gray })],
  }));
}

function numberList(items, ref = "numbers") {
  return items.map(item => new Paragraph({
    numbering: { reference: ref, level: 0 },
    spacing: { after: 80 },
    children: Array.isArray(item)
      ? item
      : [new TextRun({ text: item, font: FONT.main, size: 22, color: COLOR.black })],
  }));
}

function spacer(pts = 120) {
  return new Paragraph({ spacing: { after: pts }, children: [] });
}

function divider() {
  return new Paragraph({
    spacing: { before: 200, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.accent, space: 1 } },
    children: [],
  });
}

function metaRow(label, value, colWidths) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: colWidths[0], type: WidthType.DXA },
        borders: noBorders,
        margins: cellMargins,
        shading: { fill: COLOR.light, type: ShadingType.CLEAR },
        children: [new Paragraph({ children: [new TextRun({ text: label, font: FONT.main, size: 22, bold: true, color: COLOR.primary })] })],
      }),
      new TableCell({
        width: { size: colWidths[1], type: WidthType.DXA },
        borders: noBorders,
        margins: cellMargins,
        children: [new Paragraph({ children: [new TextRun({ text: value, font: FONT.main, size: 22, color: COLOR.black })] })],
      }),
    ],
  });
}

function dataTable(headers, rows, colWidths) {
  const headerRow = new TableRow({
    children: headers.map((h, i) => new TableCell({
      width: { size: colWidths[i], type: WidthType.DXA },
      borders,
      margins: cellMargins,
      shading: { fill: COLOR.primary, type: ShadingType.CLEAR },
      children: [new Paragraph({ children: [new TextRun({ text: h, font: FONT.main, size: 20, bold: true, color: COLOR.white })] })],
    })),
  });

  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => new TableCell({
      width: { size: colWidths[ci], type: WidthType.DXA },
      borders,
      margins: cellMargins,
      shading: ri % 2 === 0 ? { fill: COLOR.lightGray, type: ShadingType.CLEAR } : undefined,
      children: [new Paragraph({ children: Array.isArray(cell) ? cell : [new TextRun({ text: cell, font: FONT.main, size: 20, color: COLOR.black })] })],
    })),
  }));

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [headerRow, ...dataRows],
  });
}

function agentCard(name, purpose, inputs, outputs, scoringRules) {
  const items = [];
  items.push(heading3(name));
  items.push(boldPara("Purpose: ", purpose));
  items.push(para("Inputs:", { runOpts: { bold: true } }));
  items.push(...bulletList(inputs));
  items.push(para("Outputs:", { runOpts: { bold: true } }));
  items.push(...bulletList(outputs));
  if (scoringRules) {
    items.push(para("Scoring:", { runOpts: { bold: true } }));
    items.push(...bulletList(scoringRules));
  }
  items.push(spacer(80));
  return items;
}

// ── Build Document ──
const doc = new Document({
  styles: {
    default: { document: { run: { font: FONT.main, size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: FONT.main, color: COLOR.primary },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: FONT.main, color: COLOR.heading2 },
        paragraph: { spacing: { before: 300, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: FONT.main, color: COLOR.accent },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "subBullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2013", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1080, hanging: 360 } } } }] },
      { reference: "numbers", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers2", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers3", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers4", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "numbers5", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets2", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets3", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets4", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets5", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets6", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets7", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets8", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets9", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
      { reference: "bullets10", levels: [{ level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },
  sections: [
    // ════════════════════════════════════════════
    // COVER PAGE
    // ════════════════════════════════════════════
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      children: [
        spacer(2400),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 120 },
          children: [new TextRun({ text: "SlideForge AI", font: FONT.main, size: 56, bold: true, color: COLOR.primary })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 80 },
          children: [new TextRun({ text: "Product Requirements Document", font: FONT.main, size: 36, color: COLOR.accent })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
          children: [new TextRun({ text: "v2.0 \u2014 MBB Consulting Intelligence Enhancement", font: FONT.main, size: 28, color: COLOR.gray })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: COLOR.accent, space: 8 }, bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.accent, space: 8 } },
          spacing: { before: 200, after: 200 },
          children: [new TextRun({ text: "Making SlideForge Think Like a Senior MBB Partner", font: FONT.main, size: 24, italics: true, color: COLOR.heading2 })],
        }),
        spacer(600),
        // Metadata table
        new Table({
          width: { size: 5400, type: WidthType.DXA },
          columnWidths: [2200, 3200],
          rows: [
            metaRow("Version:", "2.0", [2200, 3200]),
            metaRow("Date:", "March 30, 2026", [2200, 3200]),
            metaRow("Status:", "Draft \u2014 Pending Review", [2200, 3200]),
            metaRow("Classification:", "Internal \u2014 Confidential", [2200, 3200]),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),
      ],
    },

    // ════════════════════════════════════════════
    // TOC + MAIN CONTENT
    // ════════════════════════════════════════════
    {
      properties: {
        page: {
          size: { width: PAGE_W, height: PAGE_H },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: {
        default: new Header({
          children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLOR.accent, space: 4 } },
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [
              new TextRun({ text: "SlideForge AI \u2014 PRD v2.0", font: FONT.main, size: 18, color: COLOR.gray }),
              new TextRun({ text: "\tMBB Enhancement", font: FONT.main, size: 18, color: COLOR.gray }),
            ],
          })],
        }),
      },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: COLOR.border, space: 4 } },
            children: [
              new TextRun({ text: "Confidential \u2014 Page ", font: FONT.main, size: 16, color: COLOR.gray }),
              new TextRun({ children: [PageNumber.CURRENT], font: FONT.main, size: 16, color: COLOR.gray }),
            ],
          })],
        }),
      },
      children: [
        // ── TABLE OF CONTENTS ──
        heading1("Table of Contents"),
        new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-3" }),
        new Paragraph({ children: [new PageBreak()] }),

        // ════════════════════════════════════════
        // 1. EXECUTIVE SUMMARY
        // ════════════════════════════════════════
        heading1("1. Executive Summary"),
        para("SlideForge AI is an offline-first consulting deck quality assurance platform powered by local LLMs (LM Studio) and computer vision (Surya OCR). Version 1.0 established a foundation with four parallel analysis agents covering claim grounding, narrative structure, data lineage, and visual compliance."),
        para("Version 2.0 elevates SlideForge from a quality checker to an MBB-grade consulting intelligence platform. This release introduces four new analytical agents and enhances the vision pipeline to deliver the kind of rigorous, framework-aware, insight-driven feedback that partners at McKinsey, BCG, and Bain expect from their teams."),
        spacer(80),
        boldPara("Key Objectives:", ""),
        ...numberList([
          "Detect and validate 16+ business consulting frameworks automatically",
          "Enforce the \"So What?\" test on every content slide \u2014 the core MBB differentiator",
          "Validate competitive benchmarking data for fairness and completeness",
          "Synthesize holistic slide context combining text, images, tables, and framework analysis",
          "Close the table-image-to-LLM pipeline gap for vision-based data verification",
        ]),
        divider(),

        // ════════════════════════════════════════
        // 2. PROBLEM STATEMENT
        // ════════════════════════════════════════
        heading1("2. Problem Statement"),
        heading2("2.1 Current State"),
        para("SlideForge v1.0 provides robust quality assurance through four agents: InsightExtractor (claim grounding), StructureAuditor (MECE + Pyramid Principle), DataLineageAgent (chart/Excel verification), and VisualAnalysisAgent (layout detection). A LanguageAnalysisAgent checks grammar and consulting tone."),
        spacer(80),
        heading2("2.2 Identified Gaps"),
        spacer(40),
        dataTable(
          ["Gap", "Impact", "Priority"],
          [
            ["No business framework identification", "Cannot detect whether SWOT, Porter\u2019s, BCG Matrix etc. are used correctly or completely", "P0"],
            ["No \u201CSo What?\u201D enforcement", "Slides pass QA even when they lack actionable conclusions \u2014 the #1 MBB red flag", "P0"],
            ["No competitive benchmark validation", "Benchmark slides with unfair comparisons or missing competitors go undetected", "P1"],
            ["No holistic slide context synthesis", "Each agent reports independently; no unified \u201Cwhat is this slide actually saying?\u201D view", "P1"],
            ["Table images bypass vision LLM", "Native PPTX tables are never sent to the multimodal model for cross-verification", "P1"],
            ["Framework slides only get MECE check", "A Porter\u2019s Five Forces slide missing 2 forces won\u2019t be flagged", "P0"],
          ],
          [3500, 4200, 1660],
        ),
        divider(),

        // ════════════════════════════════════════
        // 3. SOLUTION ARCHITECTURE
        // ════════════════════════════════════════
        heading1("3. Solution Architecture Overview"),
        heading2("3.1 Agent Orchestration Flow"),
        para("The enhanced pipeline operates in two phases:"),
        spacer(40),
        boldPara("Phase 1 \u2014 Parallel Analysis (7 agents concurrently):", ""),
        ...bulletList([
          "InsightExtractor (existing) \u2014 Claim grounding",
          "StructureAuditor (existing) \u2014 MECE + Pyramid Principle + Headlines",
          "DataLineageAgent (existing, enhanced) \u2014 Chart/Table/Excel verification + vision cross-ref",
          "VisualAnalysisAgent (existing, enhanced) \u2014 Layout + table image vision pipeline",
          "FrameworkIdentifierAgent (NEW) \u2014 Business framework detection and validation",
          "SoWhatTestAgent (NEW) \u2014 Actionable conclusion enforcement",
          "CompetitiveBenchmarkAgent (NEW) \u2014 Benchmark fairness and completeness",
        ]),
        spacer(40),
        boldPara("Phase 1.5 \u2014 Language Analysis:", ""),
        ...bulletList(["LanguageAnalysisAgent (existing) \u2014 Grammar, hedging, passive voice, vague quantifiers"], "bullets2"),
        spacer(40),
        boldPara("Phase 2 \u2014 Sequential Synthesis (after Phase 1 completes):", ""),
        ...bulletList(["SlideContextSynthesizer (NEW) \u2014 Holistic per-slide understanding combining all Phase 1 results"], "bullets3"),
        spacer(80),

        heading2("3.2 Scoring Model Rebalancing"),
        para("The composite score formula is rebalanced to reflect MBB priorities:"),
        spacer(40),
        dataTable(
          ["Category", "v1.0 Weight", "v2.0 Weight", "Agent"],
          [
            ["Structure", "25%", "15%", "StructureAuditor"],
            ["Claim Grounding", "30%", "20%", "InsightExtractor"],
            ["Data Accuracy", "20%", "15%", "DataLineageAgent"],
            ["Visual Compliance", "10%", "10%", "VisualAnalysisAgent"],
            ["Language Quality", "15%", "10%", "LanguageAnalysisAgent"],
            [
              [new TextRun({ text: "Framework Quality", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              "\u2014",
              [new TextRun({ text: "10%", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              [new TextRun({ text: "FrameworkIdentifierAgent (NEW)", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
            ],
            [
              [new TextRun({ text: "So What? Score", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              "\u2014",
              [new TextRun({ text: "15%", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              [new TextRun({ text: "SoWhatTestAgent (NEW)", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
            ],
            [
              [new TextRun({ text: "Benchmarking", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              "\u2014",
              [new TextRun({ text: "5%", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              [new TextRun({ text: "CompetitiveBenchmarkAgent (NEW)", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
            ],
          ],
          [2400, 1500, 1500, 3960],
        ),
        spacer(40),
        para("Note: SlideContextSynthesizer is purely advisory and does NOT contribute to the composite score."),
        new Paragraph({ children: [new PageBreak()] }),

        // ════════════════════════════════════════
        // 4. FEATURE SPECIFICATIONS
        // ════════════════════════════════════════
        heading1("4. Feature Specifications"),

        // ── 4.1 Framework Identifier ──
        heading2("4.1 Business Framework Identifier Agent"),
        spacer(40),
        dataTable(
          ["Property", "Value"],
          [
            ["Agent Name", "Framework Identifier"],
            ["Category", "framework"],
            ["Score Weight", "10%"],
            ["LLM Calls", "~0.4N per deck (pre-filtered)"],
            ["Vision Calls", "Only for visual framework candidates"],
          ],
          [2800, 6560],
        ),
        spacer(120),

        heading3("4.1.1 Supported Frameworks"),
        para("The agent detects and validates 16+ consulting frameworks:"),
        spacer(40),
        dataTable(
          ["Framework", "Required Components", "Visual Pattern"],
          [
            ["SWOT Analysis", "4 quadrants: Strengths, Weaknesses, Opportunities, Threats", "2\u00D72 grid"],
            ["Porter\u2019s Five Forces", "Rivalry, New Entrants, Substitutes, Buyer Power, Supplier Power", "Hub-spoke diagram"],
            ["BCG Growth-Share Matrix", "Stars, Cash Cows, Question Marks, Dogs", "2\u00D72 matrix with axes"],
            ["McKinsey 7S", "Strategy, Structure, Systems, Shared Values, Skills, Style, Staff", "7-node diagram"],
            ["Value Chain Analysis", "Inbound, Operations, Outbound, Marketing & Sales, Service", "Arrow chain"],
            ["PESTEL", "Political, Economic, Social, Technological, Environmental, Legal", "6-section layout"],
            ["TAM/SAM/SOM", "Total Addressable, Serviceable Addressable, Serviceable Obtainable Market", "Concentric circles"],
            ["Ansoff Matrix", "Market Penetration, Product Development, Market Development, Diversification", "2\u00D72 grid"],
            ["GE-McKinsey Nine-Box", "Industry Attractiveness \u00D7 Business Unit Strength (3\u00D73)", "3\u00D73 grid"],
            ["3C\u2019s Model", "Company, Customers, Competitors", "Triangle/Venn"],
            ["Blue Ocean Strategy Canvas", "Value curves across competing factors", "Line chart"],
            ["McKinsey Three Horizons", "Horizon 1 (core), Horizon 2 (emerging), Horizon 3 (creation)", "3-layer timeline"],
            ["Balanced Scorecard", "Financial, Customer, Internal Process, Learning & Growth", "4-quadrant"],
            ["Kano Model", "Must-be, One-dimensional, Attractive, Indifferent, Reverse", "XY curve chart"],
            ["Jobs-to-be-Done", "Functional, Emotional, Social jobs", "Job map"],
            ["Customer Journey Map", "Awareness, Consideration, Purchase, Retention, Advocacy stages", "Horizontal flow"],
          ],
          [2600, 4160, 2600],
        ),
        spacer(120),

        heading3("4.1.2 Detection Pipeline"),
        para("The agent uses a 4-phase detection approach to balance accuracy with LLM cost:"),
        spacer(40),
        boldPara("Phase A \u2014 Keyword Pre-Filter (zero LLM cost): ", "A FRAMEWORK_SIGNATURES dictionary maps each framework to a set of required keywords. For each slide, check full_text.lower() against keyword sets. If 50%+ of a framework\u2019s keywords match, the slide is marked as a candidate. Non-candidate slides are skipped entirely."),
        spacer(40),
        boldPara("Phase B \u2014 LLM Validation: ", "Candidate slides are sent to the LLM with a structured prompt requesting: framework_detected, confidence (high/medium/low), completeness (expected components, present components, missing components, completeness_score), and usage_quality (score, issues, suggestions)."),
        spacer(40),
        boldPara("Phase C \u2014 Vision Validation: ", "For candidate slides where Surya detected figure/image blocks, crop the visual region and send to the multimodal vision model. Many frameworks (BCG 2\u00D72, SWOT quadrant, strategy canvas) have distinctive visual layouts that text analysis alone may miss."),
        spacer(40),
        boldPara("Phase D \u2014 Deterministic Completeness Rules: ", "Hard-coded post-LLM validation ensures accuracy: SWOT must have 4 quadrants, Porter\u2019s must address all 5 forces, 7S must mention all 7 elements, PESTEL must cover 6 factors. These catch LLM hallucinations."),
        spacer(80),

        heading3("4.1.3 Scoring Rules"),
        ...bulletList([
          "Incomplete framework (missing required components): -15 per framework (severity: warning)",
          "Framework misuse (wrong application): -10 per instance (severity: warning)",
          "Quality improvement suggestions: -0 (severity: suggestion, no score impact)",
          "Floor: 0. Agent score = max(0, 100 - penalties)",
        ], "bullets4"),
        spacer(80),

        heading3("4.1.4 Output Schema"),
        ...bulletList([
          "Annotations: category=\"framework\", severity warning/suggestion",
          "Metadata per slide: { framework, confidence, completeness: { expected, present, missing, score }, quality: { score, issues, suggestions } }",
        ], "bullets5"),
        new Paragraph({ children: [new PageBreak()] }),

        // ── 4.2 So What? Test ──
        heading2("4.2 \"So What?\" Test Agent"),
        para("The core MBB differentiator. Every content slide in an MBB deck must answer the question: \"So what?\" \u2014 what should the audience think, feel, or do based on this slide?"),
        spacer(40),
        dataTable(
          ["Property", "Value"],
          [
            ["Agent Name", "So What Test"],
            ["Category", "so_what"],
            ["Score Weight", "15% (highest new weight \u2014 reflects MBB importance)"],
            ["LLM Calls", "~0.8N per deck (skips non-content slides)"],
          ],
          [2800, 6560],
        ),
        spacer(120),

        heading3("4.2.1 Pre-Filter"),
        para("The following slide types are automatically skipped (score = 100, no penalty):"),
        ...bulletList([
          "Title/cover slides (title contains: \"agenda\", \"contents\", \"table of contents\")",
          "Closing slides (title contains: \"thank you\", \"questions\", \"Q&A\")",
          "Appendix slides (title contains: \"appendix\", \"backup\")",
          "Section dividers (title contains: \"cover\" or slide has minimal text)",
        ], "bullets6"),
        spacer(80),

        heading3("4.2.2 LLM Analysis"),
        para("For each content slide, the LLM (acting as a demanding McKinsey engagement manager) evaluates:"),
        spacer(40),
        dataTable(
          ["Field", "Type", "Description"],
          [
            ["has_clear_so_what", "boolean", "Does the slide have a clear actionable conclusion?"],
            ["so_what_location", "enum", "\"headline\" | \"body_conclusion\" | \"implied\" | \"missing\""],
            ["stated_so_what", "string", "The actual so-what text extracted from the slide"],
            ["body_supports_so_what", "boolean", "Does the body content logically support the conclusion?"],
            ["support_gap", "string", "What\u2019s missing between body content and conclusion"],
            ["action_orientation", "enum", "\"explicit_action\" | \"implicit_action\" | \"informational_only\" | \"decorative\""],
            ["score", "int (0-100)", "Per-slide so-what quality score"],
            ["suggestion", "string", "How to strengthen the slide\u2019s conclusion"],
          ],
          [2600, 1800, 4960],
        ),
        spacer(120),

        heading3("4.2.3 Scoring Matrix"),
        dataTable(
          ["Condition", "Score", "Severity"],
          [
            ["Headline states so-what + body supports it", "100", "None"],
            ["So-what in body conclusion", "70", "Suggestion"],
            ["So-what only implied, not stated", "40", "Warning"],
            ["No clear so-what at all", "0", "Warning"],
            ["action_orientation = \"informational_only\"", "-20 penalty", "Suggestion"],
          ],
          [4500, 1800, 3060],
        ),
        spacer(40),
        para("Agent composite score = average across all content slides (non-content slides excluded)."),
        spacer(80),

        heading3("4.2.4 Distinction from StructureAuditor"),
        dataTable(
          ["Aspect", "StructureAuditor (Existing)", "So What? Agent (New)"],
          [
            ["Focus", "Headline text quality", "Slide content \u2192 conclusion logic"],
            ["Question", "\"Is the headline action-oriented?\"", "\"Does the slide body support an actionable conclusion?\""],
            ["Example pass", "\"Revenue declined 23%\" (action headline)", "Headline says decline, body shows data proving it, implication is clear"],
            ["Example fail", "\"Revenue Analysis\" (descriptive)", "\"Revenue declined 23%\" headline but body shows unrelated cost data"],
          ],
          [1800, 3780, 3780],
        ),
        new Paragraph({ children: [new PageBreak()] }),

        // ── 4.3 Competitive Benchmark ──
        heading2("4.3 Competitive Benchmarking Agent"),
        spacer(40),
        dataTable(
          ["Property", "Value"],
          [
            ["Agent Name", "Competitive Benchmark"],
            ["Category", "benchmarking"],
            ["Score Weight", "5% (applies to subset of slides only)"],
            ["LLM Calls", "~0.25N per deck (only benchmark slides)"],
          ],
          [2800, 6560],
        ),
        spacer(120),

        heading3("4.3.1 Detection Pre-Filter"),
        para("Slides are scanned for competitive/benchmarking signals:"),
        ...bulletList([
          "Keywords: \"market share\", \"benchmark\", \"peer group\", \"competitor\", \"industry average\", \"quartile\", \"percentile\", \"ranking\", \"vs\", \"versus\", \"compared to\"",
          "Tables or charts with 3+ entity columns (indicating multi-company comparison)",
          "Only slides passing this filter are processed by the LLM",
        ], "bullets7"),
        spacer(80),

        heading3("4.3.2 LLM Validation"),
        para("For detected benchmark slides, the LLM evaluates:"),
        ...bulletList([
          "comparison_type: direct_competitor | industry_benchmark | peer_group | time_series",
          "entities_compared: list of companies/groups being compared",
          "fairness_issues: mixed units (M vs B), inconsistent time periods, mixed %/absolute values",
          "completeness_issues: missing major competitors, incomplete metrics, cherry-picked data points",
          "conclusion_supported: does the benchmark data actually support the slide\u2019s stated conclusion?",
          "conclusion_gap: how the benchmark fails to support the message (if applicable)",
        ], "bullets8"),
        spacer(80),

        heading3("4.3.3 Rule-Based Fairness Checks (No LLM)"),
        para("Post-LLM deterministic checks catch common benchmark manipulation patterns:"),
        ...numberList([
          "Mixed units detection: millions vs billions in same comparison",
          "Time period inconsistency: comparing FY2024 vs TTM vs calendar year",
          "Mixed metric types: absolute values next to percentages without normalization",
          "Base year manipulation: growth rates from cherry-picked base years",
        ], "numbers2"),
        spacer(80),

        heading3("4.3.4 Scoring"),
        ...bulletList([
          "Slides without competitive data: score = 100 (no penalty)",
          "Fair and complete benchmark: score = 100",
          "Fairness issue: -15 per issue (severity: warning)",
          "Completeness issue: -10 per issue (severity: warning)",
          "Conclusion unsupported by data: -20 (severity: hard_block)",
        ], "bullets9"),
        new Paragraph({ children: [new PageBreak()] }),

        // ── 4.4 Context Synthesizer ──
        heading2("4.4 Slide Context Synthesizer Agent"),
        para("This agent provides the senior partner\u2019s perspective: a holistic understanding of what each slide communicates, combining insights from ALL other agents."),
        spacer(40),
        dataTable(
          ["Property", "Value"],
          [
            ["Agent Name", "Context Synthesizer"],
            ["Category", "Advisory (no score contribution)"],
            ["Execution Phase", "Phase 2 (runs AFTER all Phase 1 agents complete)"],
            ["LLM Calls", "~N per deck (one per slide)"],
            ["Score Impact", "None \u2014 purely advisory"],
          ],
          [2800, 6560],
        ),
        spacer(120),

        heading3("4.4.1 Input Aggregation"),
        para("For each slide, the synthesizer collects from Phase 1 results:"),
        ...bulletList([
          "Slide text content and title from document ingestion",
          "Image analysis descriptions from VisualAnalysisAgent metadata",
          "Table summaries (native + vision-extracted) from enhanced pipeline",
          "Detected framework and completeness from FrameworkIdentifierAgent",
          "Claim findings (supported/unsupported) from InsightExtractor",
          "Structure findings (narrative arc position) from StructureAuditor",
          "So-what assessment from SoWhatTestAgent",
          "Benchmark validation from CompetitiveBenchmarkAgent (if applicable)",
          "Language quality issues from LanguageAnalysisAgent",
        ], "bullets10"),
        spacer(80),

        heading3("4.4.2 LLM Synthesis Prompt"),
        para("The LLM acts as a senior McKinsey partner reviewing the combined evidence and returns per slide:"),
        spacer(40),
        dataTable(
          ["Field", "Description"],
          [
            ["core_message", "What this slide fundamentally communicates (1-2 sentences)"],
            ["so_what", "The key takeaway or implication for the audience"],
            ["audience_impact", "What the audience should think, feel, or do after seeing this slide"],
            ["narrative_role", "One of: context | problem | diagnosis | recommendation | evidence | transition | appendix"],
            ["deck_fit", "How this slide connects to the slides before and after it"],
            ["executive_summary", "One-sentence description a partner would use to describe this slide"],
            ["gaps", "What\u2019s missing to make the slide stronger (actionable list)"],
          ],
          [2600, 6760],
        ),
        spacer(80),

        heading3("4.4.3 Design Rationale"),
        para("The synthesizer runs in Phase 2 (not parallel with Phase 1) because it needs complete results from all other agents. It does NOT contribute to the composite score because its value is qualitative insight, not compliance checking. It answers the partner\u2019s question: \"Walk me through this deck slide by slide \u2014 what\u2019s the story?\""),
        new Paragraph({ children: [new PageBreak()] }),

        // ── 4.5 Table Vision Pipeline ──
        heading2("4.5 Enhanced Table Image Analysis Pipeline"),
        spacer(40),
        heading3("4.5.1 Problem"),
        para("Currently, native PPTX tables extracted via python-pptx are processed only structurally by DataLineageAgent (text-based value comparison against Excel). They are NEVER cropped from the slide preview PNG and sent to the multimodal vision model. This means:"),
        ...bulletList([
          "Tables with formatting that obscures values (merged cells, colored backgrounds) may have OCR-invisible data",
          "Tables embedded as images (common in PDF imports) are detected by Surya but not cross-referenced with native data",
          "No three-way verification: native text vs vision extraction vs Excel source",
        ]),
        spacer(80),

        heading3("4.5.2 Solution"),
        boldPara("Step 1 \u2014 Crop native tables from preview: ", "In VisualAnalysisAgent._analyze_images_with_vision(), after the existing charts loop, add a new loop for native PPTX tables. For each table in slide.get(\"tables\", []), call _crop_element_from_preview(slide, table) to extract the table region as a PIL Image."),
        spacer(40),
        boldPara("Step 2 \u2014 Vision extraction: ", "Send the cropped table image to vision_service.extract_table_content(crop) (method already exists in vision.py). Store the result as type=\"table_vision\" in the image_analysis list, including: native_text, vision_headers, vision_rows, vision_summary, confidence, and discrepancies."),
        spacer(40),
        boldPara("Step 3 \u2014 Cross-reference: ", "New method _cross_reference_table(native_text, vision_data) extracts numeric values from both native PPTX text and vision-extracted rows, compares with >5% tolerance, and returns a list of discrepancy strings."),
        spacer(40),
        boldPara("Step 4 \u2014 Three-way verification: ", "Wire into DataLineageAgent with new method verify_vision_table(vision_data, excel_data) that compares: native PPTX text values vs vision-extracted values vs Excel source values. Flag any two-way mismatches."),
        spacer(40),
        boldPara("Step 5 \u2014 Concurrency control: ", "Add _vision_semaphore = asyncio.Semaphore(2) to limit concurrent vision model calls. Cap at 4 tables per slide maximum to prevent resource exhaustion."),
        spacer(80),

        heading3("4.5.3 Frontend Display"),
        para("The existing ImageAnalysisItem type in types.ts already supports table_summary, table_headers, table_rows. Add an optional discrepancies?: string[] field. The Dashboard.tsx table insights section already filters for table items; add a discrepancy badge (red indicator) when vision-vs-native mismatches are detected."),
        new Paragraph({ children: [new PageBreak()] }),

        // ════════════════════════════════════════
        // 5. TECHNICAL SPECIFICATIONS
        // ════════════════════════════════════════
        heading1("5. Technical Specifications"),

        heading2("5.1 Files to Modify"),
        dataTable(
          ["File", "Changes"],
          [
            ["backend/app/agents/parallel_analysis.py", "4 new agent classes (FrameworkIdentifier, SoWhatTest, CompetitiveBenchmark, SlideContextSynthesizer), orchestrator updates, table vision enhancement in VisualAnalysisAgent, scoring rebalancing in QAGradingOrchestrator"],
            ["backend/app/main.py", "Phase 2 orchestration wiring, session metadata storage for new agents, slide response field additions (~line 2096)"],
            ["backend/app/models/schemas.py", "New fields on QAScorecard (framework_score, so_what_score, benchmarking_score), updated default rubric weights"],
            ["SlideForge-AI/types.ts", "New interfaces: FrameworkAnalysis, SlideContext, SoWhatResult, BenchmarkAnalysis; add optional fields to SlideAnalysis; add discrepancies to ImageAnalysisItem"],
            ["SlideForge-AI/components/Dashboard.tsx", "4 new card sections: Framework Detection, Partner View, So-What Indicator, Benchmark Validation"],
            ["SlideForge-AI/services/apiService.ts", "Add framework_score, so_what_score, benchmarking_score to ScorecardResponse mapping"],
          ],
          [3200, 6160],
        ),
        spacer(120),

        heading2("5.2 LLM Call Budget Analysis"),
        para("Impact analysis for a typical 20-slide deck (N=20):"),
        spacer(40),
        dataTable(
          ["Component", "v1.0 Calls", "v2.0 Calls", "Notes"],
          [
            ["InsightExtractor", "~20", "~20", "Unchanged"],
            ["StructureAuditor", "~22", "~22", "Arc(1) + Headlines(1) + MECE(~20)"],
            ["DataLineageAgent", "0", "0", "Rule-based, no LLM"],
            ["VisualAnalysisAgent", "~20", "~20", "Per-slide layout + vision"],
            ["LanguageAnalysisAgent", "~20", "~20", "Unchanged"],
            [
              [new TextRun({ text: "FrameworkIdentifier", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              "\u2014",
              "~8",
              "Pre-filter reduces to ~40% of slides",
            ],
            [
              [new TextRun({ text: "SoWhatTestAgent", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              "\u2014",
              "~16",
              "Skips ~20% non-content slides",
            ],
            [
              [new TextRun({ text: "CompetitiveBenchmark", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              "\u2014",
              "~5",
              "Only benchmark slides (~25%)",
            ],
            [
              [new TextRun({ text: "SlideContextSynthesizer", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              "\u2014",
              "~20",
              "All slides, Phase 2",
            ],
            [
              [new TextRun({ text: "Table Vision", font: FONT.main, size: 20, bold: true, color: COLOR.green })],
              "\u2014",
              "~10",
              "Vision model calls for native tables",
            ],
            [
              [new TextRun({ text: "TOTAL", font: FONT.main, size: 20, bold: true, color: COLOR.primary })],
              [new TextRun({ text: "~82", font: FONT.main, size: 20, bold: true, color: COLOR.primary })],
              [new TextRun({ text: "~141", font: FONT.main, size: 20, bold: true, color: COLOR.primary })],
              [new TextRun({ text: "+72% increase, mitigated by semaphore limiting", font: FONT.main, size: 20, bold: true, color: COLOR.primary })],
            ],
          ],
          [2600, 1400, 1400, 3960],
        ),
        spacer(80),

        heading2("5.3 Concurrency & Performance"),
        ...bulletList([
          "Existing _llm_semaphore(MAX_CONCURRENT_LLM=4) applies to all text LLM calls",
          "New _vision_semaphore(2) limits concurrent multimodal vision calls",
          "Phase 1 agents run in parallel via asyncio.gather \u2014 wall-clock time determined by slowest agent",
          "Phase 2 (SlideContextSynthesizer) runs sequentially after Phase 1 but parallelizes per-slide LLM calls internally",
          "Pre-filters (keyword matching, slide type detection) have zero LLM cost and reduce unnecessary calls by ~40-60%",
        ]),
        spacer(80),

        heading2("5.4 Data Flow"),
        para("All new agents follow the existing AgentResult pattern:"),
        spacer(40),
        ...bulletList([
          "Input: slides_data (list of dicts from document ingestion), guardrail (GuardrailSchema), optional excel_data",
          "Output: AgentResult(agent_name: str, findings: list[Annotation], score: int, metadata: dict)",
          "Annotations use existing categories and severities (hard_block, warning, suggestion)",
          "Metadata keyed by slide_index string for frontend consumption",
          "Session storage via session dict in main.py (existing pattern)",
        ]),
        new Paragraph({ children: [new PageBreak()] }),

        // ════════════════════════════════════════
        // 6. FRONTEND UX
        // ════════════════════════════════════════
        heading1("6. Frontend UX Specifications"),

        heading2("6.1 Framework Detection Card"),
        para("Renders below the existing frameworkDetected field in the slide detail panel:"),
        ...bulletList([
          "Framework name with confidence badge (high=green, medium=yellow, low=red)",
          "Completeness progress bar (e.g., 4/5 forces detected \u2192 80%)",
          "Missing components listed as actionable items",
          "Quality score with color-coded indicator",
          "Usage suggestions in collapsible section",
        ]),
        spacer(80),

        heading2("6.2 Partner View / Context Card"),
        para("A new \"Partner View\" tab or card showing the synthesized understanding:"),
        ...bulletList([
          "Executive summary (one-sentence partner description) in bold/highlighted",
          "Core message and audience impact as labeled text blocks",
          "Narrative role badge (context/problem/diagnosis/recommendation/evidence/transition)",
          "Deck fit showing connection to previous and next slides",
          "Gaps listed as actionable improvement items",
        ]),
        spacer(80),

        heading2("6.3 So-What Score Indicator"),
        ...bulletList([
          "Traffic light badge next to slide title in the slide navigator: green (80-100), yellow (40-79), red (0-39)",
          "In slide detail: \"So What\" location indicator showing where the conclusion lives (headline/body/implied/missing)",
          "Support gap highlighted as a warning card when body doesn\u2019t support the stated conclusion",
          "Suggested stronger so-what text displayed as an actionable recommendation",
        ]),
        spacer(80),

        heading2("6.4 Benchmark Validation Card"),
        para("Conditional card \u2014 only renders for slides with competitive data:"),
        ...bulletList([
          "Comparison type badge (direct competitor / industry benchmark / peer group / time series)",
          "Entities compared listed as tags",
          "Fairness issues as red warning items",
          "Completeness issues as yellow warning items",
          "\"Conclusion Supported\" indicator (green check or red X) with gap explanation",
        ]),
        spacer(80),

        heading2("6.5 Scorecard Updates"),
        ...bulletList([
          "Three new score categories added to the radar/pie chart: Framework Quality, So What Score, Benchmarking",
          "New score breakdown rows in the scorecard summary table",
          "Updated composite score calculation reflecting new 8-category weights",
        ]),
        new Paragraph({ children: [new PageBreak()] }),

        // ════════════════════════════════════════
        // 7. IMPLEMENTATION PLAN
        // ════════════════════════════════════════
        heading1("7. Implementation Plan"),

        heading2("7.1 Phase 1 \u2014 Backend Agents"),
        para("All four new agent classes can be developed in parallel:"),
        spacer(40),
        dataTable(
          ["Task", "Dependency", "Estimated Complexity"],
          [
            ["FrameworkIdentifierAgent class + FRAMEWORK_SIGNATURES", "None", "High \u2014 16+ frameworks, 4-phase pipeline"],
            ["SoWhatTestAgent class", "None", "Medium \u2014 single LLM prompt, scoring matrix"],
            ["CompetitiveBenchmarkAgent class", "None", "Medium \u2014 pre-filter + LLM + rule checks"],
            ["Table vision enhancement in VisualAnalysisAgent", "None", "Medium \u2014 extends existing _analyze_images_with_vision"],
          ],
          [4200, 1800, 3360],
        ),
        spacer(120),

        heading2("7.2 Phase 2 \u2014 Backend Integration"),
        para("Sequential integration after Phase 1 agents are complete:"),
        spacer(40),
        dataTable(
          ["Task", "Dependency", "Estimated Complexity"],
          [
            ["SlideContextSynthesizer class", "Phase 1 agents", "Medium \u2014 aggregation + LLM synthesis"],
            ["Update ParallelAnalysisOrchestrator", "All new agents", "Low \u2014 add to asyncio.gather"],
            ["Update QAGradingOrchestrator + scoring weights", "All new agents", "Low \u2014 new keys in score dict"],
            ["Update schemas.py (QAScorecard fields)", "Scoring changes", "Low \u2014 3 new fields"],
            ["Update main.py orchestration + response construction", "All above", "Medium \u2014 session metadata, response fields"],
          ],
          [4200, 2000, 3160],
        ),
        spacer(120),

        heading2("7.3 Phase 3 \u2014 Frontend"),
        para("Frontend changes after backend API is stable:"),
        spacer(40),
        dataTable(
          ["Task", "Dependency", "Estimated Complexity"],
          [
            ["Update types.ts with new interfaces", "Backend API", "Low"],
            ["Framework Detection Card component", "types.ts", "Medium"],
            ["Partner View / Context Card component", "types.ts", "Medium"],
            ["So-What indicator + detail card", "types.ts", "Low"],
            ["Benchmark Validation Card (conditional)", "types.ts", "Medium"],
            ["Scorecard display updates (radar chart + breakdown)", "apiService.ts", "Low"],
          ],
          [4200, 2000, 3160],
        ),
        new Paragraph({ children: [new PageBreak()] }),

        // ════════════════════════════════════════
        // 8. VERIFICATION & TESTING
        // ════════════════════════════════════════
        heading1("8. Verification & Testing Plan"),

        heading2("8.1 Agent-Level Testing"),
        dataTable(
          ["Agent", "Test Case", "Expected Result"],
          [
            ["FrameworkIdentifier", "Upload deck with SWOT slide missing Threats quadrant", "Flags incomplete SWOT, lists \"Threats\" as missing component"],
            ["FrameworkIdentifier", "Upload deck with Porter\u2019s Five Forces (all 5 present)", "Detects Porter\u2019s, completeness=100%, no warnings"],
            ["FrameworkIdentifier", "Upload deck with BCG Matrix image (no text labels)", "Vision model detects 2\u00D72 grid pattern, identifies BCG Matrix"],
            ["SoWhatTest", "Slide with headline \"Revenue Analysis\" + body with data", "Flags missing so-what, suggests action-oriented conclusion"],
            ["SoWhatTest", "Slide with \"Revenue declined 23%\" headline + supporting data", "Score=100, so_what_location=\"headline\", body_supports=true"],
            ["SoWhatTest", "Agenda slide", "Skipped (pre-filter), score=100"],
            ["CompetitiveBenchmark", "Slide comparing Q1 vs FY data for different companies", "Flags time period inconsistency as fairness issue"],
            ["CompetitiveBenchmark", "Slide with market share table, all same metrics/period", "No fairness issues, conclusion_supported evaluated"],
            ["ContextSynthesizer", "Full deck analysis", "Each slide has core_message, narrative_role, gaps populated"],
            ["Table Vision", "Slide with native PPTX table + Excel source", "Vision extraction matches native text; both verified against Excel"],
          ],
          [2200, 3800, 3360],
        ),
        spacer(120),

        heading2("8.2 Integration Testing"),
        ...numberList([
          "Upload a 15-20 slide consulting deck with mixed framework types \u2192 verify all agents produce results",
          "Verify composite score reflects new 8-category weighting (sum of weighted scores)",
          "Verify Phase 2 (ContextSynthesizer) only runs after Phase 1 completes",
          "Verify pre-filters reduce LLM calls (check logs for skipped slides)",
          "Verify frontend renders all 4 new card sections correctly",
          "Verify scorecard displays 8 categories with correct weights",
          "Verify backward compatibility: existing guardrails with old weight dicts still work",
          "Verify _vision_semaphore limits concurrent vision calls to 2",
        ], "numbers3"),
        spacer(120),

        heading2("8.3 Performance Testing"),
        ...numberList([
          "Benchmark total analysis time for 20-slide deck: target <3 minutes with LM Studio (4 concurrent LLM calls)",
          "Verify memory usage stays within bounds (Surya + vision + 7 agents)",
          "Verify no deadlocks between _llm_semaphore and _vision_semaphore",
          "Stress test with 50-slide deck to validate semaphore limiting",
        ], "numbers4"),
        new Paragraph({ children: [new PageBreak()] }),

        // ════════════════════════════════════════
        // 9. RISKS & MITIGATIONS
        // ════════════════════════════════════════
        heading1("9. Risks & Mitigations"),
        dataTable(
          ["Risk", "Impact", "Likelihood", "Mitigation"],
          [
            ["LLM call volume increase (+72%)", "Longer analysis time", "High", "Pre-filters reduce actual calls by 40-60%; semaphore limits concurrency"],
            ["Framework misidentification by LLM", "False positives in framework detection", "Medium", "Phase D deterministic rules validate LLM output; confidence scores exposed to user"],
            ["Vision model inaccuracy on complex tables", "Incorrect cross-reference discrepancies", "Medium", "5% tolerance threshold; discrepancies shown as suggestions, not hard blocks"],
            ["Context Synthesizer adding latency (Phase 2)", "Increased total analysis time", "High", "Phase 2 parallelizes per-slide LLM calls internally; can be made optional"],
            ["Scoring weight rebalancing breaks existing guardrails", "Unexpected score changes for existing users", "Low", "weights.get(k, 0) pattern ensures missing keys default to 0; no migration needed"],
            ["Local model quality insufficient for framework nuance", "Poor framework validation quality", "Medium", "Keyword pre-filter handles simple cases; LLM only validates nuanced candidates"],
          ],
          [2200, 1800, 1560, 3800],
        ),
        divider(),

        // ════════════════════════════════════════
        // 10. SUCCESS METRICS
        // ════════════════════════════════════════
        heading1("10. Success Metrics"),
        dataTable(
          ["Metric", "Target", "Measurement"],
          [
            ["Framework detection accuracy", "\u226585% precision on known framework slides", "Manual review of 50 slides with labeled frameworks"],
            ["So-What coverage", "100% content slides evaluated", "Count of slides analyzed vs skipped"],
            ["False positive rate (all new agents)", "<10% annotations overridden by users", "Override tracking via existing engagement pattern logging"],
            ["Analysis time increase", "<50% wall-clock increase for 20-slide deck", "Benchmark before/after with same deck"],
            ["User engagement with new cards", ">60% of users interact with framework/context cards", "Frontend analytics (click tracking)"],
          ],
          [3000, 2800, 3560],
        ),
        divider(),

        // ════════════════════════════════════════
        // 11. FUTURE CONSIDERATIONS
        // ════════════════════════════════════════
        heading1("11. Future Considerations"),
        ...bulletList([
          "Industry-specific framework libraries (healthcare: Value-Based Care Model; fintech: Unit Economics Canvas)",
          "Cross-slide framework consistency (same framework used differently across slides)",
          "Automated framework suggestion (\u201Cthis data would be better presented as a BCG Matrix\u201D)",
          "Benchmark data enrichment from external databases (when online mode is available)",
          "Framework template generation (auto-create a correct Porter\u2019s Five Forces layout from detected content)",
          "Multi-deck comparison (compare framework usage across related decks in an engagement)",
          "Real-time collaborative review with partner annotations synced across reviewers",
        ]),
        spacer(200),

        // ── End ──
        divider(),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 200 },
          children: [new TextRun({ text: "End of Document", font: FONT.main, size: 20, italics: true, color: COLOR.gray })],
        }),
      ],
    },
  ],
});

// ── Write to disk ──
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("F:/code project/SlideForge/SlideForge-AI/docs/SlideForge_AI_PRD_v2.0_MBB_Enhancement.docx", buffer);
  console.log("PRD generated successfully!");
});
