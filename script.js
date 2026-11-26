(() => {
  "use strict";

  // DOM Elements
  const form = document.getElementById("solver-form");
  const funcInput = document.getElementById("func-input");
  const x0Input = document.getElementById("x0-input");
  const tolInput = document.getElementById("tol-input");
  const maxIterInput = document.getElementById("max-iter-input");
  const resetDefaultsBtn = document.getElementById("reset-defaults-btn");
  const presetChips = Array.from(document.querySelectorAll(".preset-chip"));

  const alertBanner = document.getElementById("alert-banner");
  const alertIcon = document.getElementById("alert-icon");
  const alertText = document.getElementById("alert-text");

  const convergenceBadge = document.getElementById("convergence-badge");
  const deriv1Display = document.getElementById("deriv1-display");
  const deriv2Display = document.getElementById("deriv2-display");
  const convValueDisplay = document.getElementById("conv-value-display");
  const rootDisplay = document.getElementById("root-display");
  const iterCountDisplay = document.getElementById("iter-count-display");

  const stepIndicator = document.getElementById("step-indicator");
  const btnPrev = document.getElementById("btn-prev");
  const btnPlay = document.getElementById("btn-play");
  const btnNext = document.getElementById("btn-next");
  const btnShowAll = document.getElementById("btn-show-all");
  const btnZoomIn = document.getElementById("btn-zoom-in");
  const btnZoomOut = document.getElementById("btn-zoom-out");
  const btnZoomReset = document.getElementById("btn-zoom-reset");

  const canvasWrapper = document.getElementById("canvas-wrapper");
  const canvas = document.getElementById("graph-canvas");
  const ctx = canvas.getContext("2d");
  const canvasTooltip = document.getElementById("canvas-tooltip");

  const subStepTag = document.getElementById("sub-step-tag");
  const substitutionBody = document.getElementById("substitution-body");
  const iterTableBody = document.getElementById("iter-table-body");

  const themeToggle = document.getElementById("theme-toggle");
  const themeIcon = document.getElementById("theme-icon");
  const themeLabel = document.getElementById("theme-label");

  // Application State
  const state = {
    exprStr: "x^4 - 11*x + 8",
    f: null,
    df: null,
    d2f: null,
    dfStr: "",
    d2fStr: "",
    x0: 2,
    tol: 0.0001,
    maxIter: 15,
    steps: [],
    converged: false,
    finalRoot: null,
    activeStep: 0,
    showAll: false,
    isPlaying: false,
    playTimer: null,
    view: { xMin: -1, xMax: 4, yMin: -5, yMax: 10 },
    defaultView: { xMin: -1, xMax: 4, yMin: -5, yMax: 10 },
    isDragging: false,
    dragStart: null,
    hoverPoint: null,
  };

  // Formatting Helpers
  function fmt(num, digits = 6) {
    if (num === null || num === undefined || Number.isNaN(num)) return "NaN";
    if (!Number.isFinite(num)) return num > 0 ? "+\u221e" : "\u2212\u221e";
    if (Math.abs(num) !== 0 && (Math.abs(num) < 1e-5 || Math.abs(num) >= 1e7)) {
      return num.toExponential(4);
    }
    return Number(num.toFixed(digits)).toString();
  }

  function fmtFixed(num, digits = 6) {
    if (num === null || num === undefined || !Number.isFinite(num)) return fmt(num, digits);
    if (Math.abs(num) !== 0 && (Math.abs(num) < 1e-6 || Math.abs(num) >= 1e7)) {
      return num.toExponential(4);
    }
    return num.toFixed(digits);
  }

  function showAlert(message, type = "error") {
    alertBanner.classList.remove("hidden", "alert-warn", "alert-success");
    if (type === "warn") {
      alertBanner.classList.add("alert-warn");
      alertIcon.textContent = "!";
    } else if (type === "success") {
      alertBanner.classList.add("alert-success");
      alertIcon.textContent = "\u2713";
    } else {
      alertIcon.textContent = "!";
    }
    alertText.textContent = message;
  }

  function hideAlert() {
    alertBanner.classList.add("hidden");
  }

  // Safe Math Compilation (uses math.js CDN primarily, with graceful fallback if offline)
  function compileExpression(rawExpr) {
    const cleaned = rawExpr.trim();
    if (!cleaned) {
      throw new Error("Please enter a function f(x), such as x^3 - x - 2.");
    }

    if (typeof window.math !== "undefined" && typeof window.math.derivative === "function") {
      const nodeF = window.math.parse(cleaned);
      const nodeDf = window.math.derivative(nodeF, "x");
      const nodeD2f = window.math.derivative(nodeDf, "x");

      const compiledF = nodeF.compile();
      const compiledDf = nodeDf.compile();
      const compiledD2f = nodeD2f.compile();

      const evalSafe = (compiled) => (x) => {
        const val = compiled.evaluate({ x });
        if (typeof val === "object" && val !== null) {
          return NaN; // complex number or non-real result
        }
        return Number(val);
      };

      return {
        f: evalSafe(compiledF),
        df: evalSafe(compiledDf),
        d2f: evalSafe(compiledD2f),
        dfStr: nodeDf.toString(),
        d2fStr: nodeD2f.toString(),
      };
    }

    // Fallback when CDN is unreachable (e.g., offline testing)
    const jsExpr = cleaned
      .replace(/\^/g, "**")
      .replace(/\b(sin|cos|tan|asin|acos|atan|sinh|cosh|tanh|sqrt|abs|log|exp)\b/g, "Math.$1")
      .replace(/\bln\b/g, "Math.log")
      .replace(/\bpi\b/gi, "Math.PI")
      .replace(/\be\b/g, "Math.E");

    if (/[^0-9x+\-*/().,\sMathPIEsincoagqrblpx*]/.test(jsExpr.replace(/Math\.\w+/g, ""))) {
      throw new Error("Math.js CDN failed to load and the expression could not be parsed offline.");
    }

    // eslint-disable-next-line no-new-func
    const fn = new Function("x", `"use strict"; return (${jsExpr});`);
    const h = 1e-5;
    return {
      f: (x) => Number(fn(x)),
      df: (x) => (Number(fn(x + h)) - Number(fn(x - h))) / (2 * h),
      d2f: (x) => (Number(fn(x + h)) - 2 * Number(fn(x)) + Number(fn(x - h))) / (h * h),
      dfStr: "Numeric approx. (CDN offline)",
      d2fStr: "Numeric approx. (CDN offline)",
    };
  }

  // Core Newton-Raphson Solver
  function solve() {
    stopPlayback();
    hideAlert();

    const exprStr = funcInput.value.trim();
    const x0 = parseFloat(x0Input.value);
    const tol = parseFloat(tolInput.value);
    const maxIter = parseInt(maxIterInput.value, 10);

    if (Number.isNaN(x0)) {
      showAlert("Please enter a valid number for the initial guess x0.", "error");
      return;
    }
    if (Number.isNaN(tol) || tol <= 0) {
      showAlert("Tolerance must be a positive number (e.g., 0.0001).", "error");
      return;
    }
    if (Number.isNaN(maxIter) || maxIter < 1 || maxIter > 100) {
      showAlert("Max iterations must be an integer between 1 and 100.", "error");
      return;
    }

    let compiled;
    try {
      compiled = compileExpression(exprStr);
      // Test evaluation at x0
      const testVal = compiled.f(x0);
      if (Number.isNaN(testVal)) {
        throw new Error(`f(x) is undefined or non-real at x0 = ${x0}. Try a different initial guess.`);
      }
    } catch (err) {
      showAlert(`Invalid expression: ${err.message}`, "error");
      return;
    }

    state.exprStr = exprStr;
    state.f = compiled.f;
    state.df = compiled.df;
    state.d2f = compiled.d2f;
    state.dfStr = compiled.dfStr;
    state.d2fStr = compiled.d2fStr;
    state.x0 = x0;
    state.tol = tol;
    state.maxIter = maxIter;
    state.steps = [];
    state.converged = false;
    state.finalRoot = null;

    // Display symbolic derivatives
    deriv1Display.textContent = state.dfStr;
    deriv2Display.textContent = state.d2fStr;

    // Evaluate Convergence Condition at x0: | (f(x0) * f''(x0)) / (f'(x0))^2 | < 1
    const fx0 = state.f(x0);
    const dfx0 = state.df(x0);
    const d2fx0 = state.d2f(x0);

    let convVal = NaN;
    if (Number.isFinite(fx0) && Number.isFinite(dfx0) && Number.isFinite(d2fx0) && Math.abs(dfx0) > 1e-14) {
      convVal = Math.abs((fx0 * d2fx0) / (dfx0 * dfx0));
    }

    updateConvergenceBadge(convVal, dfx0);

    // Run Iterations: x_{i+1} = x_i - f(x_i) / f'(x_i)
    let xi = x0;
    let stopReason = null;

    for (let i = 0; i < maxIter; i++) {
      const fxi = state.f(xi);
      const dfxi = state.df(xi);

      if (!Number.isFinite(fxi) || !Number.isFinite(dfxi)) {
        stopReason = {
          type: "error",
          message: `Stopped at iteration i = ${i}: f(x) or f'(x) became undefined at x_${i} = ${fmt(xi)}.`,
        };
        break;
      }

      if (Math.abs(fxi) < 1e-14) {
        state.steps.push({
          i,
          xi,
          fxi,
          dfxi,
          xNext: xi,
          error: 0,
        });
        state.converged = true;
        state.finalRoot = xi;
        break;
      }

      if (Math.abs(dfxi) < 1e-12) {
        stopReason = {
          type: "error",
          message: `Derivative f'(x_${i}) = 0 at x_${i} = ${fmt(xi)} (horizontal tangent). Division by zero prevented; try a different x0.`,
        };
        break;
      }

      const xNext = xi - fxi / dfxi;
      const error = Math.abs(xNext - xi);

      if (!Number.isFinite(xNext) || Math.abs(xNext) > 1e9) {
        stopReason = {
          type: "error",
          message: `Method diverged at iteration i = ${i}: x_${i + 1} grew unbounded from x_${i} = ${fmt(xi)}. Try an initial guess closer to the root.`,
        };
        break;
      }

      state.steps.push({
        i,
        xi,
        fxi,
        dfxi,
        xNext,
        error,
      });

      if (error < tol || Math.abs(state.f(xNext)) < 1e-12) {
        state.converged = true;
        state.finalRoot = xNext;
        break;
      }

      xi = xNext;
    }

    if (!state.converged && !stopReason) {
      stopReason = {
        type: "warn",
        message: `Did not reach tolerance (${tol}) within ${maxIter} iterations. The method may be oscillating, diverging, or converging slowly from x0 = ${x0}.`,
      };
    }

    if (stopReason) {
      showAlert(stopReason.message, stopReason.type);
    }

    // Update Summary Metrics
    iterCountDisplay.textContent = String(state.steps.length);
    if (state.converged && state.finalRoot !== null) {
      rootDisplay.textContent = fmtFixed(state.finalRoot, 6);
    } else if (state.steps.length > 0) {
      rootDisplay.textContent = `~${fmtFixed(state.steps[state.steps.length - 1].xNext, 4)}`;
    } else {
      rootDisplay.textContent = "\u2014";
    }

    // Reset active step to 0 (showing x0 -> x1 first)
    state.activeStep = 0;
    state.showAll = false;
    btnShowAll.classList.remove("active-toggle");

    computeAutoView();
    renderTable();
    renderSubstitution();
    updateStepControls();
    drawGraph();
  }

  function updateConvergenceBadge(convVal, dfx0) {
    convergenceBadge.classList.remove("badge-neutral", "badge-success", "badge-warn", "badge-error");

    if (Math.abs(dfx0) <= 1e-14 || !Number.isFinite(convVal)) {
      convValueDisplay.textContent = "Undefined";
      convergenceBadge.textContent = "Convergence not guaranteed at this x0";
      convergenceBadge.classList.add("badge-error");
      return;
    }

    convValueDisplay.textContent = fmtFixed(convVal, 5);
    if (convVal < 1) {
      convergenceBadge.textContent = "Convergence condition satisfied";
      convergenceBadge.classList.add("badge-success");
    } else {
      convergenceBadge.textContent = "Convergence not guaranteed at this x0";
      convergenceBadge.classList.add("badge-warn");
    }
  }

  // Compute smart viewport bounds focused tightly on x0, x1, ..., root and their f(x_i)
  function computeAutoView() {
    const xs = [state.x0];
    const ys = [0];

    const fx0 = state.f ? state.f(state.x0) : 0;
    if (Number.isFinite(fx0) && Math.abs(fx0) < 1e4) ys.push(fx0);

    state.steps.slice(0, 6).forEach((s) => {
      if (Math.abs(s.xi) < 1e3) xs.push(s.xi);
      if (Math.abs(s.xNext) < 1e3) xs.push(s.xNext);
      if (Math.abs(s.fxi) < 1e4) ys.push(s.fxi);
    });

    let xMin = Math.min(...xs);
    let xMax = Math.max(...xs);
    let xSpan = xMax - xMin;
    if (xSpan < 0.8) {
      const mid = (xMin + xMax) / 2;
      xMin = mid - 0.8;
      xMax = mid + 0.8;
      xSpan = 1.6;
    }

    const xPad = xSpan * 0.45;
    xMin -= xPad;
    xMax += xPad;

    let yMin = Math.min(...ys);
    let yMax = Math.max(...ys);

    let ySpan = yMax - yMin;
    if (ySpan < 1.2) {
      const mid = (yMin + yMax) / 2;
      yMin = mid - 1.2;
      yMax = mid + 1.2;
      ySpan = 2.4;
    }

    // Add generous bottom/top padding so x-axis labels and tangent tips have room
    const yPadTop = ySpan * 0.32;
    const yPadBottom = Math.max(ySpan * 0.28, yMin === 0 ? ySpan * 0.32 : ySpan * 0.25);

    state.defaultView = {
      xMin,
      xMax,
      yMin: yMin - yPadBottom,
      yMax: yMax + yPadTop,
    };
    state.view = { ...state.defaultView };
  }

  // Rendering the Iteration Table
  function renderTable() {
    if (state.steps.length === 0) {
      iterTableBody.innerHTML = `<tr><td colspan="6" class="empty-cell">No iterations available for the current inputs.</td></tr>`;
      return;
    }

    iterTableBody.innerHTML = state.steps
      .map((s) => {
        const isActive = !state.showAll && s.i === state.activeStep;
        return `
          <tr data-step="${s.i}" class="${isActive ? "active-row" : ""}">
            <td>${s.i}</td>
            <td>${fmtFixed(s.xi, 6)}</td>
            <td>${fmtFixed(s.fxi, 6)}</td>
            <td>${fmtFixed(s.dfxi, 6)}</td>
            <td>${fmtFixed(s.xNext, 6)}</td>
            <td>${fmtFixed(s.error, 6)}</td>
          </tr>
        `;
      })
      .join("");
  }

  // Rendering the Active Step Substitution Card
  function renderSubstitution() {
    if (state.steps.length === 0) {
      subStepTag.textContent = "No steps";
      substitutionBody.innerHTML = `<p class="muted">Adjust the function or initial guess x<sub>0</sub> to compute iterations.</p>`;
      return;
    }

    const idx = state.showAll ? state.steps.length - 1 : state.activeStep;
    const s = state.steps[idx];
    subStepTag.textContent = state.showAll ? `Showing all (${state.steps.length} steps) \u2014 Final i = ${s.i}` : `Step i = ${s.i} (x${s.i} \u2192 x${s.i + 1})`;

    substitutionBody.innerHTML = `
      <div class="sub-equation">
        <span>x<sub>${s.i + 1}</sub> = x<sub>${s.i}</sub> &minus;</span>
        <span class="sub-frac">
          <span class="sub-frac-num">f(x<sub>${s.i}</sub>)</span>
          <span class="sub-frac-den">f&prime;(x<sub>${s.i}</sub>)</span>
        </span>
        <span>= ${fmtFixed(s.xi, 6)} &minus;</span>
        <span class="sub-frac">
          <span class="sub-frac-num">${fmtFixed(s.fxi, 6)}</span>
          <span class="sub-frac-den">${fmtFixed(s.dfxi, 6)}</span>
        </span>
        <span>=</span>
        <span class="sub-result-highlight">${fmtFixed(s.xNext, 6)}</span>
      </div>
      <div class="sub-meta">
        <span>Current guess: <strong>x<sub>${s.i}</sub> = ${fmtFixed(s.xi, 6)}</strong></span>
        <span>Next estimate: <strong>x<sub>${s.i + 1}</sub> = ${fmtFixed(s.xNext, 6)}</strong></span>
        <span>Step Error |x<sub>${s.i + 1}</sub> &minus; x<sub>${s.i}</sub>|: <strong>${fmtFixed(s.error, 6)}</strong></span>
      </div>
    `;
  }

  // Playback Controls
  function updateStepControls() {
    const total = state.steps.length;
    if (total === 0) {
      stepIndicator.textContent = "0 steps";
      btnPrev.disabled = true;
      btnNext.disabled = true;
      btnPlay.disabled = true;
      btnShowAll.disabled = true;
      return;
    }

    btnPlay.disabled = false;
    btnShowAll.disabled = false;

    if (state.showAll) {
      stepIndicator.textContent = `All ${total} iterations`;
      btnPrev.disabled = false;
      btnNext.disabled = true;
    } else {
      stepIndicator.textContent = `Step ${state.activeStep + 1} of ${total} (x${state.activeStep} \u2192 x${state.activeStep + 1})`;
      btnPrev.disabled = state.activeStep <= 0;
      btnNext.disabled = state.activeStep >= total - 1;
    }

    btnPlay.innerHTML = state.isPlaying ? "&#9646;&#9646; Pause" : "&#9654; Play";
  }

  function setActiveStep(idx) {
    if (state.steps.length === 0) return;
    state.showAll = false;
    btnShowAll.classList.remove("active-toggle");
    state.activeStep = Math.max(0, Math.min(state.steps.length - 1, idx));
    renderTable();
    renderSubstitution();
    updateStepControls();
    drawGraph();
  }

  function stopPlayback() {
    if (state.playTimer !== null) {
      clearInterval(state.playTimer);
      state.playTimer = null;
    }
    state.isPlaying = false;
    updateStepControls();
  }

  function togglePlayback() {
    if (state.steps.length === 0) return;
    if (state.isPlaying) {
      stopPlayback();
      return;
    }

    state.showAll = false;
    btnShowAll.classList.remove("active-toggle");
    if (state.activeStep >= state.steps.length - 1) {
      state.activeStep = 0;
    }
    state.isPlaying = true;
    renderTable();
    renderSubstitution();
    updateStepControls();
    drawGraph();

    state.playTimer = setInterval(() => {
      if (state.activeStep < state.steps.length - 1) {
        state.activeStep += 1;
        renderTable();
        renderSubstitution();
        updateStepControls();
        drawGraph();
      } else {
        stopPlayback();
      }
    }, 1100);
  }

  // Canvas Drawing
  function getCssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function niceStep(range, targetTicks = 7) {
    const rough = range / targetTicks;
    const pow10 = Math.pow(10, Math.floor(Math.log10(rough)));
    const frac = rough / pow10;
    let nice = 1;
    if (frac <= 1.5) nice = 1;
    else if (frac <= 3) nice = 2;
    else if (frac <= 7) nice = 5;
    else nice = 10;
    return nice * pow10;
  }

  function resizeCanvas() {
    const rect = canvasWrapper.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGraph();
  }

  function drawGraph() {
    const width = canvasWrapper.clientWidth;
    const height = canvasWrapper.clientHeight;
    if (width <= 0 || height <= 0) return;

    const { xMin, xMax, yMin, yMax } = state.view;
    const toPxX = (x) => ((x - xMin) / (xMax - xMin)) * width;
    const toPxY = (y) => height - ((y - yMin) / (yMax - yMin)) * height;

    const bg = getCssVar("--canvas-bg");
    const gridColor = getCssVar("--grid-line");
    const axisColor = getCssVar("--axis-line");
    const textMuted = getCssVar("--text-muted");
    const curveColor = getCssVar("--curve-color");
    const verticalColor = getCssVar("--vertical-color");
    const tangentActive = getCssVar("--tangent-active");
    const tangentPrev = getCssVar("--tangent-prev");
    const rootColor = getCssVar("--root-color");

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Grid lines
    const xStep = niceStep(xMax - xMin, Math.max(5, Math.floor(width / 100)));
    const yStep = niceStep(yMax - yMin, Math.max(4, Math.floor(height / 70)));

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const xStart = Math.ceil(xMin / xStep) * xStep;
    for (let x = xStart; x <= xMax; x += xStep) {
      const px = toPxX(x);
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
    }
    const yStart = Math.ceil(yMin / yStep) * yStep;
    for (let y = yStart; y <= yMax; y += yStep) {
      const py = toPxY(y);
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
    }
    ctx.stroke();

    // Axes
    const xAxisY = toPxY(0);
    const yAxisX = toPxX(0);

    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    if (xAxisY >= 0 && xAxisY <= height) {
      ctx.moveTo(0, xAxisY);
      ctx.lineTo(width, xAxisY);
    }
    if (yAxisX >= 0 && yAxisX <= width) {
      ctx.moveTo(yAxisX, 0);
      ctx.lineTo(yAxisX, height);
    }
    ctx.stroke();

    // Axis Tick Labels
    ctx.fillStyle = textMuted;
    ctx.font = `11px ${getCssVar("--font-mono")}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const clampedXAxisY = Math.max(6, Math.min(height - 18, xAxisY + 5));
    for (let x = xStart; x <= xMax; x += xStep) {
      if (Math.abs(x) < xStep * 1e-6) continue;
      const px = toPxX(x);
      if (px > 24 && px < width - 20) {
        ctx.fillText(Number(x.toPrecision(4)).toString(), px, clampedXAxisY);
      }
    }

    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    const clampedYAxisX = Math.max(36, Math.min(width - 6, yAxisX - 6));
    for (let y = yStart; y <= yMax; y += yStep) {
      if (Math.abs(y) < yStep * 1e-6) continue;
      const py = toPxY(y);
      if (py > 14 && py < height - 14) {
        ctx.fillText(Number(y.toPrecision(4)).toString(), clampedYAxisX, py);
      }
    }

    // Plot curve y = f(x)
    if (state.f) {
      ctx.strokeStyle = curveColor;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      const samples = Math.max(360, Math.floor(width));
      let drawing = false;
      let prevPy = null;

      for (let s = 0; s <= samples; s++) {
        const x = xMin + (s / samples) * (xMax - xMin);
        let y;
        try {
          y = state.f(x);
        } catch {
          y = NaN;
        }
        if (!Number.isFinite(y)) {
          drawing = false;
          prevPy = null;
          continue;
        }
        const px = toPxX(x);
        const py = toPxY(y);

        // Break path on sharp vertical asymptote jumps
        if (prevPy !== null && Math.abs(py - prevPy) > height * 1.5) {
          drawing = false;
        }

        if (!drawing) {
          ctx.moveTo(px, py);
          drawing = true;
        } else {
          ctx.lineTo(px, py);
        }
        prevPy = py;
      }
      ctx.stroke();
    }

    // Draw Iterations up to maxStepIdx
    if (state.steps.length > 0) {
      const maxStepIdx = state.showAll ? state.steps.length - 1 : state.activeStep;
      const labelPositions = [];

      const drawXLabel = (label, xVal, color, isBold) => {
        const px = toPxX(xVal);
        if (px < -10 || px > width + 10) return;

        // Place point dot on x-axis
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px, xAxisY, isBold ? 5 : 3.8, 0, Math.PI * 2);
        ctx.fill();

        // Avoid overlapping labels on the x-axis
        const tooClose = labelPositions.some((pos) => Math.abs(pos - px) < 22);
        if (tooClose && !isBold) return;
        labelPositions.push(px);

        const labelY = xAxisY < height - 30 ? xAxisY + 18 : xAxisY - 14;
        ctx.font = `${isBold ? "700" : "600"} 12px ${getCssVar("--font-serif")}`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(label, px, labelY);
      };

      for (let idx = 0; idx <= maxStepIdx; idx++) {
        const step = state.steps[idx];
        const isCurrent = !state.showAll && idx === state.activeStep;
        const pxXi = toPxX(step.xi);
        const pyFxi = toPxY(step.fxi);
        const pxNext = toPxX(step.xNext);

        // 1. Vertical dashed line from (x_i, 0) to (x_i, f(x_i))
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = isCurrent ? verticalColor : tangentPrev;
        ctx.lineWidth = isCurrent ? 2 : 1.3;
        ctx.beginPath();
        ctx.moveTo(pxXi, xAxisY);
        ctx.lineTo(pxXi, pyFxi);
        ctx.stroke();
        ctx.restore();

        // 2. Tangent line from (x_i, f(x_i)) down to (x_{i+1}, 0)
        // Extend slightly past (x_i, f(x_i)) for textbook look
        const dx = pxNext - pxXi;
        const dy = xAxisY - pyFxi;
        ctx.strokeStyle = isCurrent ? tangentActive : tangentPrev;
        ctx.lineWidth = isCurrent ? 2.4 : 1.5;
        ctx.beginPath();
        ctx.moveTo(pxXi - dx * 0.14, pyFxi - dy * 0.14);
        ctx.lineTo(pxNext, xAxisY);
        ctx.stroke();

        // Point on curve (x_i, f(x_i))
        ctx.fillStyle = isCurrent ? tangentActive : verticalColor;
        ctx.beginPath();
        ctx.arc(pxXi, pyFxi, isCurrent ? 5 : 3.5, 0, Math.PI * 2);
        ctx.fill();

        // Label x_i on x-axis
        drawXLabel(`x${step.i}`, step.xi, isCurrent ? verticalColor : textMuted, isCurrent);

        // Label x_{i+1} on x-axis for the active/last visible step
        if (idx === maxStepIdx) {
          drawXLabel(`x${step.i + 1}`, step.xNext, tangentActive, true);
        }
      }
    }

    // Converged root marker
    if (state.converged && state.finalRoot !== null) {
      const pxRoot = toPxX(state.finalRoot);
      if (pxRoot >= -10 && pxRoot <= width + 10) {
        ctx.fillStyle = rootColor;
        ctx.beginPath();
        ctx.arc(pxRoot, xAxisY, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = bg;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.font = `700 11px ${getCssVar("--font-sans")}`;
        ctx.fillStyle = rootColor;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText("Root", pxRoot, xAxisY - 10);
      }
    }

    // Hover crosshair
    if (state.hoverPoint && state.f) {
      const { x, y } = state.hoverPoint;
      const px = toPxX(x);
      const py = toPxY(y);
      if (Number.isFinite(py) && py >= 0 && py <= height) {
        ctx.fillStyle = curveColor;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Zoom & Pan Interactions
  function zoomAt(factor, cxRatio = 0.5, cyRatio = 0.5) {
    const { xMin, xMax, yMin, yMax } = state.view;
    const xCenter = xMin + (xMax - xMin) * cxRatio;
    const yCenter = yMax - (yMax - yMin) * cyRatio;
    const newXSpan = (xMax - xMin) * factor;
    const newYSpan = (yMax - yMin) * factor;
    if (newXSpan < 1e-6 || newXSpan > 1e6) return;

    state.view = {
      xMin: xCenter - newXSpan * cxRatio,
      xMax: xCenter + newXSpan * (1 - cxRatio),
      yMin: yCenter - newYSpan * (1 - cyRatio),
      yMax: yCenter + newYSpan * cyRatio,
    };
    drawGraph();
  }

  canvasWrapper.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvasWrapper.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = (e.clientY - rect.top) / rect.height;
    const factor = e.deltaY < 0 ? 0.84 : 1.18;
    zoomAt(factor, cx, cy);
  }, { passive: false });

  canvasWrapper.addEventListener("pointerdown", (e) => {
    state.isDragging = true;
    state.dragStart = { x: e.clientX, y: e.clientY, view: { ...state.view } };
    canvasWrapper.setPointerCapture(e.pointerId);
  });

  canvasWrapper.addEventListener("pointermove", (e) => {
    const rect = canvasWrapper.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (state.isDragging && state.dragStart) {
      const dxPx = e.clientX - state.dragStart.x;
      const dyPx = e.clientY - state.dragStart.y;
      const v = state.dragStart.view;
      const dxMath = (dxPx / rect.width) * (v.xMax - v.xMin);
      const dyMath = (dyPx / rect.height) * (v.yMax - v.yMin);
      state.view = {
        xMin: v.xMin - dxMath,
        xMax: v.xMax - dxMath,
        yMin: v.yMin + dyMath,
        yMax: v.yMax + dyMath,
      };
      canvasTooltip.classList.add("hidden");
      drawGraph();
      return;
    }

    if (state.f) {
      const x = state.view.xMin + (mx / rect.width) * (state.view.xMax - state.view.xMin);
      let y = NaN;
      try {
        y = state.f(x);
      } catch {
        y = NaN;
      }
      if (Number.isFinite(y)) {
        state.hoverPoint = { x, y };
        canvasTooltip.textContent = `x = ${fmtFixed(x, 3)}, f(x) = ${fmtFixed(y, 3)}`;
        canvasTooltip.style.left = `${Math.min(rect.width - 175, Math.max(8, mx + 12))}px`;
        canvasTooltip.style.top = `${Math.max(8, my - 32)}px`;
        canvasTooltip.classList.remove("hidden");
        drawGraph();
      } else {
        state.hoverPoint = null;
        canvasTooltip.classList.add("hidden");
      }
    }
  });

  canvasWrapper.addEventListener("pointerup", (e) => {
    state.isDragging = false;
    state.dragStart = null;
    if (canvasWrapper.hasPointerCapture(e.pointerId)) {
      canvasWrapper.releasePointerCapture(e.pointerId);
    }
  });

  canvasWrapper.addEventListener("pointerleave", () => {
    state.hoverPoint = null;
    canvasTooltip.classList.add("hidden");
    drawGraph();
  });

  // Event Listeners
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    solve();
  });

  resetDefaultsBtn.addEventListener("click", () => {
    funcInput.value = "x^4 - 11*x + 8";
    x0Input.value = "2";
    tolInput.value = "0.0001";
    maxIterInput.value = "15";
    presetChips.forEach((c, idx) => c.classList.toggle("active", idx === 0));
    solve();
  });

  presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      funcInput.value = chip.dataset.fn;
      x0Input.value = chip.dataset.x0;
      tolInput.value = chip.dataset.tol;
      maxIterInput.value = chip.dataset.max;
      presetChips.forEach((c) => c.classList.toggle("active", c === chip));
      solve();
    });
  });

  btnPrev.addEventListener("click", () => {
    stopPlayback();
    if (state.showAll) {
      setActiveStep(Math.max(0, state.steps.length - 1));
    } else {
      setActiveStep(state.activeStep - 1);
    }
  });

  btnNext.addEventListener("click", () => {
    stopPlayback();
    setActiveStep(state.activeStep + 1);
  });

  btnPlay.addEventListener("click", togglePlayback);

  btnShowAll.addEventListener("click", () => {
    stopPlayback();
    state.showAll = !state.showAll;
    btnShowAll.classList.toggle("active-toggle", state.showAll);
    renderTable();
    renderSubstitution();
    updateStepControls();
    drawGraph();
  });

  btnZoomIn.addEventListener("click", () => zoomAt(0.75));
  btnZoomOut.addEventListener("click", () => zoomAt(1.33));
  btnZoomReset.addEventListener("click", () => {
    state.view = { ...state.defaultView };
    drawGraph();
  });

  // Delegate table row clicks
  iterTableBody.addEventListener("click", (e) => {
    const row = e.target.closest("tr[data-step]");
    if (!row) return;
    stopPlayback();
    setActiveStep(parseInt(row.dataset.step, 10));
  });

  // Theme Toggle
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    themeIcon.innerHTML = theme === "dark" ? "&#9728;" : "&#9790;";
    themeLabel.textContent = theme === "dark" ? "Light Mode" : "Dark Mode";
    try {
      localStorage.setItem("nr-theme", theme);
    } catch {
      // Ignore storage restrictions
    }
    drawGraph();
  }

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  // Initialize
  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("load", () => {
    let savedTheme = "light";
    try {
      savedTheme = localStorage.getItem("nr-theme") || "light";
    } catch {
      savedTheme = "light";
    }
    applyTheme(savedTheme);
    resizeCanvas();
    solve();
  });
})();
