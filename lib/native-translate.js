(() => {
  const TOOL_TERMINAL_SKIP = '[data-testid*="terminal"]:not([data-testid="overview-panel-row-terminal"]):not([data-testid="aux-pane-terminals-section"]):not([data-testid="toggle-bottom-terminal-panel"]):not([data-testid="bottom-terminal-panel-new"]):not([data-testid="bottom-terminal-panel-close"]):not([data-testid="terminal-add-button"]):not([data-testid="new-tab-card-new-terminal"])';
  const TOOL_SKIP_BG_TASK_SELECTOR = `[data-agy-powertools-root],[data-agy-translate-root],[data-agy-translate-hidden],[data-agy-management-page],[data-testid="user-input-step"],[data-testid="agent-input-box"],[data-testid="worked-for-collapsible"],[data-testid="agy-completion-tools-toggle"],[data-testid="agy-response-actions"],[data-testid="turn-cards-container"],[data-testid="changed-files-card"],[data-testid="thinking-collapsible-trigger"],[data-testid="planner-response-text"],[data-testid="progress-update-response-text"],[data-testid="planner-response-debug-error"],[data-markdown-root],pre,code,kbd,samp,script,style,svg,textarea,input,[contenteditable],.monaco-editor,.monaco-diff-editor,.view-lines,.cm-editor,.cm-content,.xterm,.code-block,.shiki,.hljs,[data-testid*="diff"],${TOOL_TERMINAL_SKIP},[data-testid*="code-viewer"],[data-testid*="file-viewer"],a[href^="file:"]`;
  const TOOL_SKIP_SELECTOR = `${TOOL_SKIP_BG_TASK_SELECTOR},.font-mono`;
  const BLOCK_CODE_SKIP_SELECTOR = 'pre,code,kbd,samp,script,style';
  const TECHNICAL_TOKEN_RE = /```[\s\S]*?```|`[^`\r\n]+`|https?:\/\/[^\s)>"'`\],;]+(?<![.,;:])|(?:(?<=^|[\s(\["'`=:,])(?:~|\.{1,2})?\/(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\/)*(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_.-]+\/){2,}(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_.-]+\\)+(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)(?:#L\d+(?:-L?\d+)?)?|(?:[a-zA-Z0-9_-]*[0-9_.-][a-zA-Z0-9_.-]*\/(?:\.?[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*)|[a-zA-Z0-9_.-]+\/(?:[a-zA-Z0-9_-]*[0-9_-][a-zA-Z0-9_.-]*|[a-zA-Z0-9_-]*(?:\.[a-zA-Z0-9_-]+)+))(?:#L\d+(?:-L?\d+)?)?|[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+#L\d+(?:-L?\d+)?)|\b[a-zA-Z0-9_-]+\.(?:[mc]?js|tsx?|jsx?|py|go|rs|java|c|cpp|h|hpp|json|ya?ml|toml|md|css|scss|html|sh|bash|zsh|ps1|log|txt|sql|vue|svelte|mjs|cjs|mts|cts)(?:#L\d+(?:-L?\d+)?)?\b|(?:^|(?<=[\s(,]))--[a-zA-Z0-9][a-zA-Z0-9_-]*(?:=[^\s,;)]+)?|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|@[a-zA-Z0-9_.-]+|#\d+\b|\bv\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?\b/g;

  const SHELL_CMD_PREFIX_RE = /^(?:sudo|env|nohup|bash|sh|zsh|fish|pwsh|node|npm|npx|pnpm|yarn|bun|deno|python\d*|pip\d*|pytest|uv|cargo|rustc|git|gh|rg|fd|grep|sed|awk|cat|curl|wget|ssh|scp|rsync|docker|kubectl|cmake|ninja|systemctl|journalctl|pkill|lsof|netstat|chmod|chown|mkdir)(?:\s|$)|^(?:[A-Z_][A-Z0-9_]*=\S+\s+|(?:~|\.\.?|\/)[^\s]+\/)|&&|\|\||\$\(|\s(?:--[a-zA-Z0-9_-]+|-[a-zA-Z]{1,3}\b)/;

  function isLikelyShellCommand(text) {
    const s = String(text || '').trim();
    if (!s) return false;
    return SHELL_CMD_PREFIX_RE.test(s);
  }

  const LEADING_ACTION_VERB_RE = /^(?:check|read|edit|updat|creat|delet|remov|verif|test|build|runn|ran|start|stopp|install|compil|search|explor|list|inspect|fetch|load|writ|pars|patch|fix|debug|reinstall|rebuild|restart|sync|wait|ask|open|clos|generat|format|lint|migrat|deploy|configur|monitor|prob|scann|watch|upgrad|download|upload|clean)/i;

  function shouldSkipTranslation(text, targetLang = 'zh-CN') {
    if (typeof text !== 'string' || !text.trim() || targetLang === 'en') return true;
    const plainNoNums = text.replace(/\b\d+(?:\.\d+)?\b/g, ' ').trim();
    const stripped = text
      .replace(TECHNICAL_TOKEN_RE, ' ')
      .replace(/\b\d+(?:\.\d+)?\b/g, ' ')
      .trim();
    if (!stripped) return true;
    const hadTechToken = stripped !== plainNoNums;
    const enWords = stripped.match(/\b[A-Za-z][A-Za-z'-]{1,}\b/g) || [];
    const latinChars = (stripped.match(/[A-Za-z]/g) || []).length;
    if (targetLang === 'ja') {
      const kanaChars = (stripped.match(/[\u3040-\u30ff]/g) || []).length;
      if (kanaChars >= 4 && enWords.length <= 4) return true;
    } else if (targetLang === 'ko') {
      const hangulChars = (stripped.match(/[\uac00-\ud7af]/g) || []).length;
      if (hangulChars >= 4 && enWords.length <= 4) return true;
    } else if (targetLang === 'ru') {
      const cyrillicChars = (stripped.match(/[\u0400-\u04ff]/g) || []).length;
      if (cyrillicChars >= 4 && enWords.length <= 4) return true;
    }
    if (enWords.length < 2 || latinChars < 5) {
      if (enWords.length === 1 && latinChars >= 5 && hadTechToken && LEADING_ACTION_VERB_RE.test(enWords[0])) {
        return false;
      }
      return true;
    }
    if (targetLang === 'zh-CN' || targetLang === 'zh-TW') {
      const cjkChars = (stripped.match(/[\u4e00-\u9fff]/g) || []).length;
      if (cjkChars >= 4 && enWords.length <= 4) {
        const ratio = cjkChars / (cjkChars + enWords.length * 2);
        if (ratio >= 0.45) return true;
      }
    }
    return false;
  }

  function scanParagraphBreaks(str) {
    const breaks = [];
    let inFence = false;
    let fenceChar = '';
    let idx = 0;
    const lines = str.split('\n');
    let blankRunStart = -1;
    let blankRunEnd = -1;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineStart = idx;
      const lineEnd = idx + line.length + (i < lines.length - 1 ? 1 : 0);
      idx = lineEnd;
      const trimmed = line.trimStart();
      const fenceMatch = /^(```+|~~~+)/.exec(trimmed);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        if (!inFence) {
          if (blankRunStart >= 0 && blankRunStart > 0) breaks.push(blankRunEnd);
          inFence = true;
          fenceChar = marker;
        } else if (marker === fenceChar) {
          inFence = false;
          fenceChar = '';
        }
        blankRunStart = -1;
        continue;
      }
      if (!inFence && trimmed === '') {
        if (blankRunStart < 0) blankRunStart = lineStart;
        blankRunEnd = lineEnd;
      } else {
        if (blankRunStart >= 0 && blankRunStart > 0) {
          breaks.push(blankRunEnd);
        }
        blankRunStart = -1;
      }
    }
    return breaks;
  }

  function findSentenceBreakOutsideCode(str, minIndex = 80) {
    let inFence = false;
    let inInlineCode = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (!inInlineCode && (i === 0 || str[i - 1] === '\n') && (str.startsWith('```', i) || str.startsWith('~~~', i))) {
        inFence = !inFence;
        i += 2;
        continue;
      }
      if (!inFence && ch === '`') {
        inInlineCode = !inInlineCode;
        continue;
      }
      if (!inFence && ch === '\n') inInlineCode = false;
      if (inFence || inInlineCode || i < minIndex) continue;
      if (ch === '.' || ch === '!' || ch === '?') {
        const prev = i > 0 ? str[i - 1] : '';
        const next = str[i + 1] || '';
        const afterNext = str[i + 2] || '';
        if (/[a-zA-Z)"'`\]]/.test(prev) && /\s/.test(next)) {
          if (afterNext === '' || /[A-Z0-9`"(\['\n]/.test(afterNext)) {
            let cut = i + 1;
            while (cut < str.length && str[cut] === ' ') cut++;
            return cut;
          }
        }
      }
    }
    return -1;
  }

  function hasOpenCodeFence(str) {
    let inFence = false;
    let fenceChar = '';
    for (const line of str.split('\n')) {
      const m = /^(```+|~~~+)/.exec(line.trimStart());
      if (!m) continue;
      const ch = m[1][0];
      if (!inFence) { inFence = true; fenceChar = ch; }
      else if (ch === fenceChar) { inFence = false; fenceChar = ''; }
    }
    return inFence;
  }

  function startsMarkdownBlock(str) {
    return /^(```+|~~~+|#{1,6}\s+|>\s?|[-*]\s+|\d+\.\s+)/.test(String(str || '').trimStart());
  }

  function hasBlankLineBoundaryBefore(text, absPos, candidate = '') {
    if (absPos <= 0) return true;
    if (/^(?:[ \t]*\r?\n){2,}/.test(candidate)) return true;
    if (text[absPos - 1] === '\n' && /^[ \t]*\r?\n/.test(candidate)) return true;
    return /\n[ \t]*\n[ \t]*$/.test(text.slice(0, absPos));
  }

  function joinTranslatedParts(parts) {
    let out = '';
    for (const rawPart of parts) {
      const part = String(rawPart || '').trim();
      if (!part) continue;
      if (!out) {
        out = part;
        continue;
      }
      const prevLast = out[out.length - 1];
      const nextFirst = part[0];
      const noSpaceAfter = /[\s(\[“‘\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f\uff09\u300d\u300f\u300b]/.test(prevLast);
      const noSpaceBefore = /^[\s.,;:!?)\]”’\u3001\u3002\uff0c\uff1a\uff1b\uff01\uff1f\uff09\u300d\u300f\u300b]/.test(nextFirst);
      const needSpace = !noSpaceAfter && !noSpaceBefore && (
        (/[A-Za-z0-9`*_]/.test(prevLast) && /[A-Za-z0-9`*_]/.test(nextFirst))
        || (/[\u4e00-\u9fff]/.test(prevLast) && /[A-Za-z0-9`]/.test(nextFirst))
        || (/[A-Za-z0-9`]/.test(prevLast) && /[\u4e00-\u9fff]/.test(nextFirst))
        || (/[.!?]/.test(prevLast) && /[A-Za-z0-9`"(\[\u4e00-\u9fff]/.test(nextFirst))
      );
      out += (needSpace ? ' ' : '') + part;
    }
    return out;
  }

  function sliceThinkingSegments(rawText, processedOffset = 0, isStreaming = false, { forceFlushTail = false } = {}) {
    const text = String(rawText || '');
    const start = Math.max(0, Math.min(processedOffset, text.length));
    const slice = text.slice(start);
    if (!slice) return { committed: [], startsNewPara: [], endsPara: [], nextOffset: start, pendingTail: '' };

    const committed = [];
    const startsNewPara = [];
    const endsPara = [];
    let atParaStart = hasBlankLineBoundaryBefore(text, start, slice);
    if (!atParaStart && start > 0 && text[start - 1] === '\n') {
      const prevNl = text.lastIndexOf('\n', start - 2);
      const prevLine = text.slice(prevNl + 1, start - 1).trim();
      if (startsMarkdownBlock(prevLine) || /^(```+|~~~+)/.test(prevLine)) atParaStart = true;
    }

    let localPos = 0;
    const paraBreaks = scanParagraphBreaks(slice);
    for (const brk of paraBreaks) {
      const candidate = slice.slice(localPos, brk);
      if (candidate.trim()) {
        const startsNew = atParaStart || hasBlankLineBoundaryBefore(text, start + localPos, candidate) || startsMarkdownBlock(candidate);
        committed.push(candidate);
        startsNewPara.push(startsNew);
        endsPara.push(true);
        atParaStart = true;
      } else if (hasBlankLineBoundaryBefore(text, start + brk, '')) {
        atParaStart = true;
      }
      localPos = brk;
    }

    let tail = slice.slice(localPos);
    if (!isStreaming || forceFlushTail) {
      if (tail.trim()) {
        const startsNew = atParaStart || hasBlankLineBoundaryBefore(text, start + localPos, tail) || startsMarkdownBlock(tail);
        committed.push(tail);
        startsNewPara.push(startsNew);
        endsPara.push(!isStreaming);
      }
      return { committed, startsNewPara, endsPara, nextOffset: text.length, pendingTail: '' };
    }

    while (tail.length >= 100 && !hasOpenCodeFence(tail)) {
      const sentCut = findSentenceBreakOutsideCode(tail, 55);
      if (sentCut <= 0) break;
      const candidate = tail.slice(0, sentCut);
      if (candidate.trim()) {
        const startsNew = atParaStart || hasBlankLineBoundaryBefore(text, start + localPos, candidate) || startsMarkdownBlock(candidate);
        committed.push(candidate);
        startsNewPara.push(startsNew);
        endsPara.push(false);
        atParaStart = false;
      }
      localPos += sentCut;
      tail = slice.slice(localPos);
    }

    return {
      committed,
      startsNewPara,
      endsPara,
      nextOffset: start + localPos,
      pendingTail: tail
    };
  }

  function isSafeHref(url) {
    if (typeof url !== 'string') return false;
    try {
      const parsed = new URL(url.trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  const WORD_SCRIPT_RE = /[\u4e00-\u9fff\u3040-\u30ff\u0e00-\u0e7f]/;
  const wordSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : null;

  function segmentWords(str) {
    if (typeof str !== 'string' || !str) return [];
    const parts = [];
    const rawParts = str.split(' ');
    for (let i = 0; i < rawParts.length; i++) {
      const piece = rawParts[i];
      const hasTrailingSpace = i < rawParts.length - 1;
      if (!piece) {
        if (hasTrailingSpace) parts.push(' ');
        continue;
      }
      if (wordSegmenter && WORD_SCRIPT_RE.test(piece)) {
        const segs = Array.from(wordSegmenter.segment(piece), s => s.segment);
        for (let j = 0; j < segs.length; j++) {
          parts.push(hasTrailingSpace && j === segs.length - 1 ? `${segs[j]} ` : segs[j]);
        }
      } else {
        parts.push(hasTrailingSpace ? `${piece} ` : piece);
      }
    }
    return parts;
  }

  function createOfficialStagger({ maxTotalMs = 500 } = {}) {
    let seqTick = 0;
    let tickScheduled = false;
    const schedMicro = typeof globalThis.queueMicrotask === 'function'
      ? fn => globalThis.queueMicrotask(fn)
      : fn => Promise.resolve().then(fn);
    const nextTick = () => {
      if (!tickScheduled) {
        tickScheduled = true;
        schedMicro(() => { seqTick++; tickScheduled = false; });
      }
      return seqTick;
    };
    const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());
    const state = {
      horizon: 0,
      burstStart: -Infinity,
      lastClaim: -Infinity,
      burstDeadline: -Infinity,
      interval: null,
      lastTurn: undefined
    };
    const capMs = Math.max(40, Math.min(500, Number(maxTotalMs) || 500));
    const W = 4 / 3;
    return {
      claim(count) {
        if (count <= 0) return [];
        const turn = nextTick();
        const t = now();
        const isNewBurst = state.lastTurn !== turn && t - state.lastClaim > 16;
        state.lastTurn = turn;
        state.lastClaim = t;
        if (isNewBurst) {
          if (Number.isFinite(state.burstStart)) {
            const elapsed = Math.min(capMs, t - state.burstStart);
            state.interval = state.interval === null ? elapsed : state.interval + 0.3 * (elapsed - state.interval);
          }
          const span = Math.min(capMs, state.interval ?? Math.min(240, capMs));
          const overlapping = state.horizon > t;
          state.burstStart = t;
          state.burstDeadline = t + Math.min(capMs, overlapping ? span * W : span);
          state.horizon = Math.max(t, state.horizon);
        }
        const step = Math.min(70, Math.max(0, state.burstDeadline - state.horizon) / count);
        const delays = [];
        for (let i = 0; i < count; i++) {
          delays.push(Math.max(0, Math.round(state.horizon + i * step - state.burstStart)));
        }
        state.horizon += count * step;
        return delays;
      }
    };
  }

  function appendInlineNodes(doc, parent, text, { featherFrom = -1, animate = false, blockIdx = 0, seenKeys = null, stagger = null } = {}) {
    let tokenSeq = 0;
    const pendingAnims = [];
    const registerWordSpan = (wordText, key) => {
      const span = doc.createElement('span');
      span.className = 'agy-tr-word';
      span.textContent = wordText;
      parent.append(span);
      pendingAnims.push({ el: span, key });
    };

    const addTextSpan = (chunk, idx) => {
      if (!chunk) return;
      if (seenKeys) {
        const words = segmentWords(chunk);
        for (let w = 0; w < words.length; w++) {
          const word = words[w];
          const key = `w:${blockIdx}:${tokenSeq}:${idx}:${w}`;
          if (animate && stagger && !seenKeys.has(key)) {
            seenKeys.add(key);
            registerWordSpan(word, key);
          } else {
            seenKeys.add(key);
            parent.append(doc.createTextNode ? doc.createTextNode(word) : word);
          }
        }
        tokenSeq++;
        return;
      }
      if (featherFrom >= 0 && idx + chunk.length > featherFrom) {
        const splitAt = featherFrom - idx;
        let rest = chunk;
        if (splitAt > 0) {
          const head = chunk.slice(0, splitAt);
          parent.append(doc.createTextNode ? doc.createTextNode(head) : head);
          rest = chunk.slice(splitAt);
        }
        const span = doc.createElement('span');
        span.className = 'agy-tr-word';
        span.textContent = rest;
        parent.append(span);
      } else {
        parent.append(doc.createTextNode ? doc.createTextNode(chunk) : chunk);
      }
    };

    const maybeAnimateNode = (node, key) => {
      if (!seenKeys) return;
      const already = seenKeys.has(key);
      seenKeys.add(key);
      if (!animate || !stagger || already) return;
      pendingAnims.push({ el: node, key });
    };

    const appendFormatted = (raw, baseOffset) => {
      const tokenRe = /`([^`\r\n]+)`|\*\*([^*\r\n]+)\*\*|\*([^*\r\n]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      let last = 0;
      let m;
      while ((m = tokenRe.exec(raw))) {
        if (m.index > last) addTextSpan(raw.slice(last, m.index), baseOffset + last);
        const key = `n:${blockIdx}:${tokenSeq++}:${baseOffset + m.index}`;
        if (m[1] != null) {
          const code = doc.createElement('code');
          code.className = 'agy-tr-code';
          code.textContent = m[1];
          maybeAnimateNode(code, key);
          parent.append(code);
        } else if (m[2] != null) {
          const strong = doc.createElement('strong');
          strong.textContent = m[2];
          maybeAnimateNode(strong, key);
          parent.append(strong);
        } else if (m[3] != null) {
          const em = doc.createElement('em');
          em.textContent = m[3];
          maybeAnimateNode(em, key);
          parent.append(em);
        } else if (m[4] != null && m[5] != null && isSafeHref(m[5])) {
          const link = doc.createElement('a');
          link.className = 'agy-tr-link';
          link.setAttribute('href', m[5]);
          link.setAttribute('target', '_blank');
          link.setAttribute('rel', 'noopener noreferrer');
          link.textContent = m[4];
          maybeAnimateNode(link, key);
          parent.append(link);
        } else {
          addTextSpan(m[0], baseOffset + m.index);
        }
        last = tokenRe.lastIndex;
      }
      if (last < raw.length) addTextSpan(raw.slice(last), baseOffset + last);
    };

    appendFormatted(text, 0);
    if (pendingAnims.length && stagger) {
      const delays = stagger.claim(pendingAnims.length);
      for (let i = 0; i < pendingAnims.length; i++) {
        const el = pendingAnims[i].el;
        const delay = delays[i] ?? 0;
        if (el.style) el.style.animation = `agy-tr-fade-in 0.2s ease-out ${delay}ms both`;
      }
    }
  }

  function clearChildren(el) {
    if (!el) return;
    if (typeof el.replaceChildren === 'function') {
      el.replaceChildren();
      return;
    }
    while (el.firstChild) {
      const child = el.firstChild;
      if (typeof child.remove === 'function') child.remove();
      else if (typeof el.removeChild === 'function') el.removeChild(child);
      else break;
    }
  }

  function renderMarkdownInto(doc, container, markdown, { featherFrom = -1, animate = false, seenKeys = null, stagger = null } = {}) {
    clearChildren(container);
    const localFeather = startOffset => (featherFrom >= 0 ? Math.max(0, featherFrom - startOffset) : -1);
    const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    let charOffset = 0;
    let blockSeq = 0;

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed) {
        charOffset += line.length + 1;
        i++;
        continue;
      }

      const fenceMatch = /^(```+|~~~+)(.*)$/.exec(trimmed);
      if (fenceMatch) {
        const marker = fenceMatch[1][0];
        const codeLines = [];
        charOffset += line.length + 1;
        i++;
        while (i < lines.length) {
          const cur = lines[i];
          if (cur.trimStart().startsWith(marker.repeat(3))) {
            charOffset += cur.length + 1;
            i++;
            break;
          }
          codeLines.push(cur);
          charOffset += cur.length + 1;
          i++;
        }
        const pre = doc.createElement('pre');
        pre.className = 'agy-tr-pre';
        const code = doc.createElement('code');
        code.textContent = codeLines.join('\n');
        pre.append(code);
        container.append(pre);
        blockSeq++;
        continue;
      }

      const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
      if (heading) {
        const p = doc.createElement('p');
        p.className = 'agy-tr-heading';
        const strong = doc.createElement('strong');
        appendInlineNodes(doc, strong, heading[2], { featherFrom: localFeather(charOffset), animate, blockIdx: blockSeq++, seenKeys, stagger });
        p.append(strong);
        container.append(p);
        charOffset += line.length + 1;
        i++;
        continue;
      }

      if (/^>\s?/.test(trimmed)) {
        const bq = doc.createElement('blockquote');
        bq.className = 'agy-tr-quote';
        const quoteLines = [];
        const startOffset = charOffset;
        while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
          quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
          charOffset += lines[i].length + 1;
          i++;
        }
        appendInlineNodes(doc, bq, quoteLines.join(' '), { featherFrom: localFeather(startOffset), animate, blockIdx: blockSeq++, seenKeys, stagger });
        container.append(bq);
        continue;
      }

      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        const ordered = /^\d+\.\s+/.test(trimmed);
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        list.className = 'agy-tr-list';
        const listBlockIdx = blockSeq++;
        let itemIdx = 0;
        while (i < lines.length) {
          const curTrim = lines[i].trim();
          const itemMatch = ordered ? /^\d+\.\s+(.+)$/.exec(curTrim) : /^[-*]\s+(.+)$/.exec(curTrim);
          if (!itemMatch) break;
          const li = doc.createElement('li');
          appendInlineNodes(doc, li, itemMatch[1], { featherFrom: localFeather(charOffset), animate, blockIdx: `${listBlockIdx}-${itemIdx++}`, seenKeys, stagger });
          list.append(li);
          charOffset += lines[i].length + 1;
          i++;
        }
        container.append(list);
        continue;
      }

      const paraLines = [];
      const startOffset = charOffset;
      while (i < lines.length) {
        const curTrim = lines[i].trim();
        if (!curTrim || /^(```+|~~~+|#{1,6}\s+|>\s?|[-*]\s+|\d+\.\s+)/.test(curTrim)) break;
        paraLines.push(lines[i].trimEnd());
        charOffset += lines[i].length + 1;
        i++;
      }
      const p = doc.createElement('p');
      p.className = 'agy-tr-p';
      appendInlineNodes(doc, p, paraLines.join('\n'), { featherFrom: localFeather(startOffset), animate, blockIdx: blockSeq++, seenKeys, stagger });
      container.append(p);
    }
  }

  function tokenizeForFlow(text) {
    if (typeof text !== 'string' || !text) return [];
    const tokens = [];
    const re = /`[^`\r\n]+`|https?:\/\/[^\s]+|[A-Za-z0-9_.-]+(?:'[A-Za-z]+)?\s?|\s+|[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]{1,2}|./gu;
    let m;
    while ((m = re.exec(text))) {
      tokens.push(m[0]);
    }
    return tokens;
  }

  function isReducedMotion() {
    try {
      return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    } catch {
      return false;
    }
  }

  function createStreamPacer(doc, container, { onFirstToken, onProgress, isStreamingBlock = true, prefixText = '', seenKeys: externalSeenKeys = null } = {}) {
    let bufferText = '';
    let renderedLen = 0;
    let rafId = 0;
    let pendingFinal = null;
    let cancelled = false;
    let notifiedFirst = false;
    const seenKeys = externalSeenKeys || new Set();
    const stagger = createOfficialStagger({ maxTotalMs: isStreamingBlock ? 500 : 160 });

    const sched = typeof globalThis.requestAnimationFrame === 'function'
      ? fn => globalThis.requestAnimationFrame(fn)
      : fn => setTimeout(fn, 16);
    const unsched = id => {
      if (!id) return;
      if (typeof globalThis.cancelAnimationFrame === 'function') globalThis.cancelAnimationFrame(id);
      else clearTimeout(id);
    };

    function flushRender(text, animate) {
      if (cancelled || !container?.isConnected) return;
      const fullText = prefixText ? joinTranslatedParts([prefixText, text]) : text;
      renderMarkdownInto(doc, container, fullText, { animate: animate && !isReducedMotion(), seenKeys, stagger });
      renderedLen = text.length;
      if (!notifiedFirst && renderedLen > 0) {
        notifiedFirst = true;
        onFirstToken?.();
      }
      onProgress?.(renderedLen);
    }

    function step() {
      rafId = 0;
      if (cancelled || !container?.isConnected) return;
      if (pendingFinal !== null) {
        const { finalText, animate, onDone } = pendingFinal;
        pendingFinal = null;
        bufferText = finalText;
        flushRender(finalText, animate);
        onDone?.();
        return;
      }
      if (bufferText && renderedLen < bufferText.length) {
        flushRender(bufferText, true);
      }
    }

    function push(delta) {
      if (cancelled || typeof delta !== 'string' || !delta) return;
      bufferText += delta;
      if (isReducedMotion()) {
        flushRender(bufferText, false);
        return;
      }
      if (!rafId) rafId = sched(step);
    }

    function finish(finalText, { instant = false, onDone } = {}) {
      if (cancelled) return;
      const text = typeof finalText === 'string' ? finalText : bufferText;
      if (instant || isReducedMotion()) {
        unsched(rafId);
        rafId = 0;
        pendingFinal = null;
        bufferText = text;
        flushRender(text, false);
        onDone?.();
        return;
      }
      bufferText = text;
      pendingFinal = { finalText: text, animate: true, onDone };
      if (!rafId) rafId = sched(step);
    }

    function cancel() {
      cancelled = true;
      unsched(rafId);
      rafId = 0;
      pendingFinal = null;
    }

    return { push, finish, cancel, get renderedLen() { return renderedLen; } };
  }

  function extractDomMarkdownText(root) {
    if (!root) return '';
    const pieces = [];
    const walk = node => {
      if (!node) return;
      if (node.nodeType === 3) {
        pieces.push(node.nodeValue || '');
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = String(node.tagName || '').toUpperCase();
      if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'SVG') return;
      if (tag === 'PRE') {
        pieces.push('\n```\n' + (node.textContent || '') + '\n```\n');
        return;
      }
      if (tag === 'CODE') {
        pieces.push('`' + (node.textContent || '') + '`');
        return;
      }
      const isBlock = tag === 'P' || tag === 'DIV' || tag === 'LI' || tag === 'BLOCKQUOTE' || /^H[1-6]$/.test(tag);
      for (const child of node.childNodes || []) walk(child);
      if (isBlock) pieces.push('\n\n');
    };
    walk(root);
    return pieces.join('').replace(/\n{3,}/g, '\n\n').trim();
  }

  function createDetailTranslator({ doc = globalThis.document, request, getOptions, uiText, fiber = null, adapter = null } = {}) {
    if (!doc) return { sync() {}, handleEvent() {}, dispose() {} };

    let disposed = false;
    let streamSeq = 0;
    let batchSeq = 0;
    let syncTimer = null;
    let batchTimer = null;
    let styleEl = null;
    let domObserver = null;

    const blocks = new WeakMap(); // containerEl -> BlockState
    const blockList = new Set();
    const activeStreams = new Map(); // streamId -> { state, segment, buffer, timer }
    const segmentCache = new Map(); // `${lang}|${engine}|${model}|${context}|${raw}` -> { text, provider, degraded, reason }
    const inlineOriginals = new Map(); // TextNode -> { original, last, hostEl, hadTip, prevTip }
    const pendingInlineQueue = new Map(); // TextNode -> { node, original, hostEl }
    const inFlightInlineNodes = new WeakMap(); // TextNode -> string
    const inlineHostSet = new Set();

    function currentConfig() {
      const opts = getOptions?.() || {};
      const active = Boolean(opts.enabled && opts.detailTranslation && opts.language !== 'en');
      const targetLang = opts.language && opts.language !== 'en' ? opts.language : 'zh-CN';
      const mode = opts.detailTranslationMode === 'bilingual' ? 'bilingual' : 'replace';
      const engine = opts.detailTranslationEngine || 'free';
      const model = opts.detailTranslationModel || '';
      const baseUrl = opts.detailTranslationBaseUrl || '';
      const sig = `${active}|${targetLang}|${mode}|${engine}|${baseUrl}|${model}`;
      return { active, targetLang, mode, engine, model, baseUrl, sig };
    }

    let lastConfigSig = '';

    function rememberSegment(key, val) {
      if (!val?.text) return;
      segmentCache.delete(key);
      segmentCache.set(key, val);
      if (segmentCache.size > 1500) segmentCache.delete(segmentCache.keys().next().value);
    }

    function ensureStyle() {
      if (styleEl && styleEl.isConnected) return;
      if (!doc.head || typeof doc.createElement !== 'function') return;
      styleEl = doc.createElement('style');
      styleEl.dataset.agyTranslateStyle = '';
      styleEl.textContent = `
        [data-agy-translate-hidden="true"]{display:none!important}
        [data-agy-translate-pending="true"]{opacity:.84;transition:opacity 140ms ease-out}
        [data-agy-translate-bilingual-src="true"]{opacity:.62;font-size:.92em;border-left:2px solid var(--border);padding-left:8px;margin-bottom:6px}
        [data-agy-translate-root="block"]{display:flex;flex-direction:column;gap:8px;color:inherit;font-size:inherit;line-height:1.625;overflow-wrap:break-word;user-select:text}
        [data-agy-translate-root="block"] .agy-tr-segs{display:flex;flex-direction:column;gap:8px}
        [data-agy-translate-root="block"] .agy-tr-seg{display:flex;flex-direction:column;gap:8px}
        html[data-agy-compact] [data-agy-translate-root="block"],html[data-agy-compact] [data-agy-translate-root="block"] .agy-tr-segs,html[data-agy-compact] [data-agy-translate-root="block"] .agy-tr-seg{line-height:1.4;gap:6px}
        [data-agy-translate-root="block"] .agy-tr-p{margin:0}
        [data-agy-translate-root="block"] strong,[data-agy-translate-root="block"] b{font-weight:600}
        [data-agy-translate-root="block"] .agy-tr-heading{margin:8px 0 4px;font-weight:600}
        [data-agy-translate-root="block"] .agy-tr-heading:first-child{margin-top:0}
        [data-agy-translate-root="block"] .agy-tr-list{margin:4px 0;padding-left:18px;display:flex;flex-direction:column;gap:2px}
        [data-agy-translate-root="block"] ul.agy-tr-list{list-style:disc}
        [data-agy-translate-root="block"] ol.agy-tr-list{list-style:decimal}
        [data-agy-translate-root="block"] .agy-tr-quote{margin:4px 0;padding-left:8px;border-left:2px solid var(--border);opacity:.9}
        [data-agy-translate-root="block"] .agy-tr-code{font-family:var(--font-mono,ui-monospace,monospace);font-size:.9em;padding:2px 4px;border-radius:4px;background:var(--muted,color-mix(in srgb,var(--secondary) 75%,transparent));color:var(--code,var(--code-foreground,inherit))}
        [data-agy-translate-root="block"] .agy-tr-pre{margin:6px 0;padding:8px 10px;border-radius:6px;background:var(--muted,color-mix(in srgb,var(--secondary) 70%,transparent));overflow:auto;font-family:var(--font-mono,ui-monospace,monospace);font-size:.88em;line-height:1.4}
        [data-agy-translate-root="block"] .agy-tr-link{color:var(--primary);text-decoration:underline;text-underline-offset:2px}
        @keyframes agy-tr-fade-in{0%{opacity:0}100%{opacity:1}}
        @keyframes agy-tr-inline-in{0%{opacity:.45}100%{opacity:1}}
        .agy-tr-word{display:inline}
        .agy-tr-inline-reveal{animation:agy-tr-inline-in 160ms ease-out both}
        .agy-tr-tail{margin:0;color:var(--muted-foreground);opacity:.58;white-space:pre-wrap;animation:agy-tr-fade-in 200ms ease-out both}
        [data-agy-translate-host="true"],:has(> [data-agy-translate-root="toggle"]){position:relative}
        .agy-tr-toggle-wrap{position:absolute;top:4px;right:6px;z-index:3;display:inline-flex;align-items:center;gap:4px;opacity:0;pointer-events:none;transition:opacity 150ms ease}
        [data-agy-translate-host="true"]:hover .agy-tr-toggle-wrap,:has(> [data-agy-translate-root="toggle"]):hover > [data-agy-translate-root="toggle"],[data-agy-translate-host="true"]:focus-within .agy-tr-toggle-wrap,:has(> [data-agy-translate-root="toggle"]):focus-within > [data-agy-translate-root="toggle"],.agy-tr-toggle-wrap[data-pinned="true"]{opacity:1;pointer-events:auto}
        .agy-tr-toggle{height:18px;padding:0 6px;border-radius:5px;border:1px solid color-mix(in srgb,var(--border) 68%,transparent);background:color-mix(in srgb,var(--card,var(--muted)) 92%,transparent);color:var(--secondary-foreground,var(--foreground));font:inherit;font-size:11px;line-height:1;cursor:pointer;opacity:.92;transition:opacity 120ms ease,color 120ms ease,border-color 120ms ease}
        .agy-tr-toggle:hover,.agy-tr-toggle:focus-visible{opacity:1;color:var(--foreground);border-color:color-mix(in srgb,var(--border) 95%,var(--foreground))}
        .agy-tr-toggle[data-showing-original="true"]{color:var(--foreground);border-color:color-mix(in srgb,var(--border) 95%,var(--foreground));opacity:1}
        .agy-tr-degraded-dot{width:6px;height:6px;border-radius:50%;background:var(--warning,#f59e0b);display:inline-block;flex:none}
        @media(prefers-reduced-motion:reduce){.agy-tr-word,.agy-tr-tail,.agy-tr-inline-reveal,[data-agy-translate-pending="true"]{animation:none!important;transition:none!important}}
      `;
      doc.head.append(styleEl);
    }

    function readThinkingFiber(trigger) {
      if (typeof fiber !== 'function') return null;
      try {
        for (let node = fiber(trigger), depth = 0; node && depth < 12; node = node.return, depth++) {
          const p = node.memoizedProps;
          if (p && typeof p.thinking === 'string') {
            const hasDuration = Boolean(p.thinkingDuration && (Number(p.thinkingDuration.seconds) > 0 || Number(p.thinkingDuration.nanos) > 0));
            const trigText = (trigger.textContent || '').trim();
            const isDoneTrigger = /^(Thought for \d+|思考了 \d+|Thought Process|思考过程|思考過程)/.test(trigText);
            const active = !hasDuration && !p.stepHasNonThinkingContent && !isDoneTrigger;
            return {
              rawText: p.thinking,
              isStreaming: active
            };
          }
        }
      } catch { /* Safe fallback to DOM extraction. */ }
      return null;
    }

    function readNarrationFiber(el) {
      if (typeof fiber !== 'function') return null;
      try {
        for (let node = fiber(el), depth = 0; node && depth < 12; node = node.return, depth++) {
          const p = node.memoizedProps;
          if (p?.step?.case === 'plannerResponse' && p.step?.value) {
            const v = p.step.value;
            const raw = String(v.modifiedResponse || v.response || '').trim();
            const hasTools = Array.isArray(v.toolCalls) && v.toolCalls.length > 0;
            const running = p.step.status === 1 || p.step.status === 2 || p.step.status === 4;
            return { rawText: raw, hasTools, isStreaming: running };
          }
        }
      } catch {}
      return null;
    }

    function isDisplayContents(el) {
      if (!el) return false;
      try {
        if (typeof globalThis.getComputedStyle === 'function') {
          const disp = globalThis.getComputedStyle(el)?.display;
          if (disp === 'contents') return true;
          if (disp && disp !== 'none') return false;
        }
      } catch {}
      const cls = typeof el.className === 'string' ? el.className : '';
      return Boolean(el.style?.display === 'contents' || el.classList?.contains?.('shimmer-text-content') || cls.split(/\s+/).includes('shimmer-text-content'));
    }

    function resolveVisibleBox(el) {
      let cur = el;
      for (let depth = 0; cur && depth < 5; depth++) {
        if (!cur.isConnected) return { target: el, rect: null };
        if (cur.hasAttribute?.('data-agy-translate-hidden') || isDisplayContents(cur)) {
          cur = cur.parentElement;
          continue;
        }
        const rect = typeof cur.getBoundingClientRect === 'function' ? cur.getBoundingClientRect() : null;
        return { target: cur, rect };
      }
      return { target: el, rect: typeof el?.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null };
    }

    function isStrictlyInViewport(el) {
      const { target, rect } = resolveVisibleBox(el);
      if (!target?.isConnected) return false;
      if (!rect) return true;
      const vh = globalThis.innerHeight || 900;
      return Boolean(rect.height > 0 && rect.bottom >= 0 && rect.top <= vh);
    }

    function isElementVisible(el) {
      const { target, rect } = resolveVisibleBox(el);
      if (!target?.isConnected) return false;
      if (visibleSet.has(target)) return true;
      if (!io) return true;
      if (rect) {
        const vh = globalThis.innerHeight || 900;
        if (rect.height > 0 && rect.bottom >= -600 && rect.top <= vh + 600) {
          visibleSet.add(target);
          return true;
        }
      }
      return false;
    }

    const visibleSet = new WeakSet();
    const observedEls = new WeakSet();
    const io = typeof globalThis.IntersectionObserver === 'function'
      ? new globalThis.IntersectionObserver(entries => {
          let wokeAny = false;
          for (const entry of entries) {
            if (entry.isIntersecting) {
              visibleSet.add(entry.target);
              wokeAny = true;
            } else {
              visibleSet.delete(entry.target);
            }
          }
          if (wokeAny && !disposed) scheduleSync(40);
        }, { rootMargin: '600px 0px' })
      : null;

    function observeVisibility(el) {
      if (!io || !el) return;
      const { target } = resolveVisibleBox(el);
      if (!target || observedEls.has(target)) return;
      observedEls.add(target);
      try { io.observe(target); } catch {}
    }

    function abortStream(streamId) {
      const entry = activeStreams.get(streamId);
      if (!entry) return;
      entry.pacer?.cancel?.();
      activeStreams.delete(streamId);
      void request?.('translate.abort', { streamId }).catch(() => {});
    }

    function cleanupBlockState(state) {
      if (!state) return;
      state.disposed = true;
      if (state.tailTimer) { clearTimeout(state.tailTimer); state.tailTimer = null; }
      for (const seg of state.segments) {
        seg.pacer?.cancel?.();
        if (seg.streamId) abortStream(seg.streamId);
      }
      state.mountEl?.remove?.();
      state.toggleWrapEl?.remove?.();
      state.toggleAnchor?.removeAttribute?.('data-agy-translate-host');
      if (state.nativeMd) {
        state.nativeMd.removeAttribute?.('data-agy-translate-hidden');
        state.nativeMd.removeAttribute?.('data-agy-translate-pending');
        state.nativeMd.removeAttribute?.('data-agy-translate-bilingual-src');
      }
      if (state.hostEl) blocks.delete(state.hostEl);
      blockList.delete(state);
    }

    function syncTogglePin(state) {
      if (!state.toggleWrapEl) return;
      const pinned = Boolean(state.showOriginal || state.degradedActive);
      if (pinned) state.toggleWrapEl.setAttribute('data-pinned', 'true');
      else state.toggleWrapEl.removeAttribute('data-pinned');
    }

    function applyBlockVisibility(state, cfg) {
      const showOrigin = Boolean(state.showOriginal);
      const hasReadyTranslation = state.segments.some(s => s.renderedLen > 0 || s.status === 'done');
      if (state.toggleBtn) {
        state.toggleBtn.textContent = showOrigin ? uiText('译文', 'Translated') : uiText('原文', 'Original');
        state.toggleBtn.setAttribute('data-showing-original', showOrigin ? 'true' : 'false');
      }
      syncTogglePin(state);
      if (state.nativeMd) {
        if (showOrigin) {
          state.nativeMd.removeAttribute('data-agy-translate-hidden');
          state.nativeMd.removeAttribute('data-agy-translate-pending');
          state.nativeMd.removeAttribute('data-agy-translate-bilingual-src');
        } else if (!hasReadyTranslation) {
          state.nativeMd.removeAttribute('data-agy-translate-hidden');
          state.nativeMd.removeAttribute('data-agy-translate-bilingual-src');
          if (state.segments.some(s => s.status === 'pending' || s.status === 'streaming')) {
            state.nativeMd.setAttribute('data-agy-translate-pending', 'true');
          } else {
            state.nativeMd.removeAttribute('data-agy-translate-pending');
          }
        } else if (cfg.mode === 'bilingual') {
          state.nativeMd.removeAttribute('data-agy-translate-hidden');
          state.nativeMd.removeAttribute('data-agy-translate-pending');
          state.nativeMd.setAttribute('data-agy-translate-bilingual-src', 'true');
        } else {
          state.nativeMd.removeAttribute('data-agy-translate-pending');
          state.nativeMd.removeAttribute('data-agy-translate-bilingual-src');
          state.nativeMd.setAttribute('data-agy-translate-hidden', 'true');
        }
      }
      if (state.mountEl) {
        if (showOrigin || !hasReadyTranslation) state.mountEl.setAttribute('data-agy-translate-hidden', 'true');
        else state.mountEl.removeAttribute('data-agy-translate-hidden');
      }
    }

    function renderParaState(para, { animate = false } = {}) {
      if (!para?.el) return;
      const doneTexts = [];
      for (const s of para.segments) {
        if (s.status === 'done' && s.translated) doneTexts.push(s.translated);
        else break;
      }
      const combined = joinTranslatedParts(doneTexts);
      if (!combined) return;
      para.el.removeAttribute?.('data-agy-translate-hidden');
      const useAnim = Boolean(animate && !isReducedMotion());
      renderMarkdownInto(doc, para.el, combined, {
        animate: useAnim,
        seenKeys: para.seenKeys,
        stagger: useAnim ? createOfficialStagger({ maxTotalMs: 160 }) : null
      });
    }

    function renderPendingTail(state) {
      if (!state.tailEl) return;
      const tail = (state.pendingTail || '').trim();
      const hasReadyTranslation = state.segments.some(s => s.renderedLen > 0 || s.status === 'done');
      const hasIncompleteSegment = state.segments.some(s => s.status !== 'done' || s.renderedLen === 0);
      if (state.showOriginal || !hasReadyTranslation || !tail || hasIncompleteSegment) {
        state.tailEl.setAttribute('data-agy-translate-hidden', 'true');
        state.tailEl.textContent = '';
        return;
      }
      state.tailEl.removeAttribute('data-agy-translate-hidden');
      state.tailEl.textContent = tail;
    }

    function ensureBlockUi(state, cfg) {
      if (!state.mountEl || !state.mountEl.isConnected) {
        const mount = doc.createElement('div');
        mount.setAttribute('data-agy-translate-root', 'block');
        const list = doc.createElement('div');
        list.className = 'agy-tr-segs';
        const tailEl = doc.createElement('p');
        tailEl.className = 'agy-tr-tail';
        tailEl.setAttribute('data-agy-translate-hidden', 'true');
        mount.append(list, tailEl);
        state.mountEl = mount;
        state.segsEl = list;
        state.tailEl = tailEl;
        if (state.nativeMd?.parentElement) {
          if (state.nativeMd.nextSibling) state.nativeMd.parentElement.insertBefore(mount, state.nativeMd.nextSibling);
          else state.nativeMd.parentElement.append(mount);
        } else {
          state.bodyHost.append(mount);
        }
      }
      if (state.toggleAnchor && !state.toggleAnchor.hasAttribute?.('data-agy-translate-host')) {
        state.toggleAnchor.setAttribute?.('data-agy-translate-host', 'true');
      }
      if (!state.toggleWrapEl || !state.toggleWrapEl.isConnected) {
        state.toggleAnchor?.setAttribute?.('data-agy-translate-host', 'true');
        const wrap = doc.createElement('div');
        wrap.setAttribute('data-agy-translate-root', 'toggle');
        wrap.className = 'agy-tr-toggle-wrap';
        (state.toggleAnchor || state.bodyHost).append(wrap);
        const dot = doc.createElement('span');
        dot.className = 'agy-tr-degraded-dot';
        dot.setAttribute('data-agy-translate-hidden', 'true');
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'agy-tr-toggle';
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          state.showOriginal = !state.showOriginal;
          applyBlockVisibility(state, currentConfig());
          renderPendingTail(state);
        });
        wrap.append(dot, btn);
        state.toggleWrapEl = wrap;
        state.degradedDotEl = dot;
        state.toggleBtn = btn;
      }
      applyBlockVisibility(state, cfg);
    }

    function markDegraded(state, segRes) {
      if (!state.degradedDotEl) return;
      state.degradedActive = Boolean(segRes?.degraded);
      if (state.degradedActive) {
        state.degradedDotEl.removeAttribute('data-agy-translate-hidden');
        state.degradedDotEl.setAttribute('data-pt-tip', uiText(`LLM 请求失败，已自动降级为机器翻译（${segRes.reason || '连接异常'}）`, `LLM unavailable, fell back to machine translation (${segRes.reason || 'network error'})`));
      } else {
        state.degradedDotEl.setAttribute('data-agy-translate-hidden', 'true');
        state.degradedDotEl.removeAttribute('data-pt-tip');
      }
      syncTogglePin(state);
    }

    const makeCacheKey = (cfg, ctx, rawText) =>
      `${cfg.targetLang}|${cfg.engine}|${cfg.baseUrl}|${cfg.model}|${String(ctx || '').slice(-100)}|${String(rawText || '').trim()}`;

    function finalizeParagraphCache(state, para, cfg) {
      if (!para || !para.closed || para.cachedFull || !para.segments.length) return;
      if (!para.segments.every(s => s.status === 'done')) return;
      const rawFull = para.segments.map(s => s.raw).join('').trim();
      if (!rawFull || shouldSkipTranslation(rawFull, cfg.targetLang)) {
        para.cachedFull = true;
        return;
      }
      const translatedFull = joinTranslatedParts(para.segments.map(s => s.translated));
      if (!translatedFull || translatedFull === rawFull) return;
      const lastSeg = para.segments[para.segments.length - 1];
      rememberSegment(makeCacheKey(cfg, para.prevCtx || '', rawFull), {
        text: translatedFull,
        provider: lastSeg?.provider,
        degraded: lastSeg?.degraded,
        reason: lastSeg?.reason
      });
      para.cachedFull = true;
    }

    function appendCommittedPieces(state, sliced) {
      const count = sliced.committed.length;
      for (let i = 0; i < count; i++) {
        const piece = sliced.committed[i];
        const startsNew = sliced.startsNewPara ? sliced.startsNewPara[i] : (state.paragraphs.length === 0);
        const endsThisPara = Boolean(sliced.endsPara?.[i]);
        let para = state.paragraphs[state.paragraphs.length - 1];
        if (startsNew || !para || para.closed) {
          if (para) para.closed = true;
          const paraEl = doc.createElement('div');
          paraEl.className = 'agy-tr-seg';
          paraEl.setAttribute('data-agy-translate-hidden', 'true');
          state.segsEl.append(paraEl);
          para = {
            index: state.paragraphs.length,
            el: paraEl,
            seenKeys: new Set(),
            segments: [],
            prevCtx: '',
            closed: false,
            cachedFull: false
          };
          state.paragraphs.push(para);
        }
        const seg = {
          index: state.segments.length,
          raw: piece,
          status: 'pending',
          translated: '',
          renderedLen: 0,
          streamId: '',
          el: para.el,
          para
        };
        para.segments.push(seg);
        state.segments.push(seg);
        if (endsThisPara) para.closed = true;
      }
    }

    async function drainBlockQueue(state, cfg) {
      if (state.running || disposed) return;
      state.running = true;
      try {
        while (!disposed && !state.disposed && state.hostEl.isConnected) {
          const nextSeg = state.segments.find(s => s.status === 'pending');
          if (!nextSeg) break;

          const para = nextSeg.para;
          const posInPara = para ? para.segments.indexOf(nextSeg) : 0;
          const prevPara = para && para.index > 0 ? state.paragraphs[para.index - 1] : null;
          const prevParaText = prevPara ? joinTranslatedParts(prevPara.segments.filter(s => s.status === 'done').map(s => s.translated)) : '';
          const prefixText = posInPara > 0 && para ? joinTranslatedParts(para.segments.slice(0, posInPara).map(s => s.translated)) : '';
          if (para && posInPara === 0) para.prevCtx = prevParaText.slice(-220);
          const ctx = posInPara > 0 ? (prefixText.slice(-220) || para?.prevCtx || '') : (para?.prevCtx || '');
          const cacheKey = makeCacheKey(cfg, ctx, nextSeg.raw);
          const localHit = segmentCache.get(cacheKey);
          if (localHit) {
            nextSeg.translated = localHit.text;
            nextSeg.provider = localHit.provider;
            nextSeg.degraded = localHit.degraded;
            nextSeg.reason = localHit.reason;
            nextSeg.status = 'done';
            nextSeg.renderedLen = localHit.text.length;
            if (para) renderParaState(para, { animate: false });
            markDegraded(state, localHit);
            finalizeParagraphCache(state, para, cfg);
            applyBlockVisibility(state, cfg);
            renderPendingTail(state);
            continue;
          }

          if (shouldSkipTranslation(nextSeg.raw, cfg.targetLang)) {
            nextSeg.translated = nextSeg.raw;
            nextSeg.status = 'done';
            nextSeg.renderedLen = nextSeg.raw.length;
            if (para) renderParaState(para, { animate: false });
            finalizeParagraphCache(state, para, cfg);
            applyBlockVisibility(state, cfg);
            renderPendingTail(state);
            continue;
          }

          nextSeg.status = 'streaming';
          nextSeg.renderedLen = 0;
          const streamId = `tr-${++streamSeq}`;
          nextSeg.streamId = streamId;
          const pacer = createStreamPacer(doc, nextSeg.el, {
            isStreamingBlock: state.isStreamingBlock,
            prefixText,
            seenKeys: para?.seenKeys || null,
            onFirstToken: () => {
              para?.el?.removeAttribute?.('data-agy-translate-hidden');
              nextSeg.renderedLen = Math.max(nextSeg.renderedLen, 1);
              applyBlockVisibility(state, currentConfig());
              renderPendingTail(state);
            },
            onProgress: len => {
              nextSeg.renderedLen = len;
            }
          });
          nextSeg.pacer = pacer;
          const streamState = { state, segment: nextSeg, text: '', sawEvent: false, pacer };
          activeStreams.set(streamId, streamState);
          applyBlockVisibility(state, cfg);
          renderPendingTail(state);
          try {
            const reply = await request('translate.stream', {
              streamId,
              text: nextSeg.raw,
              context: ctx,
              targetLang: cfg.targetLang
            });
            if (disposed || state.disposed || nextSeg.streamId !== streamId) {
              pacer.cancel();
              break;
            }
            const finalText = typeof reply?.text === 'string' && reply.text ? reply.text : (streamState.text || nextSeg.raw);
            nextSeg.translated = finalText;
            nextSeg.provider = reply?.provider;
            nextSeg.degraded = reply?.degraded;
            nextSeg.reason = reply?.reason;
            nextSeg.status = 'done';
            nextSeg.streamId = '';
            markDegraded(state, reply);
            pacer.finish(finalText, {
              instant: Boolean(reply?.cached || reply?.skipped) || !isStrictlyInViewport(state.hostEl),
              onDone: () => {
                para?.el?.removeAttribute?.('data-agy-translate-hidden');
                nextSeg.renderedLen = finalText.length;
                nextSeg.pacer = null;
                finalizeParagraphCache(state, para, currentConfig());
                applyBlockVisibility(state, currentConfig());
                renderPendingTail(state);
              }
            });
            if (!reply?.skipped) {
              rememberSegment(cacheKey, { text: finalText, provider: reply?.provider, degraded: reply?.degraded, reason: reply?.reason });
            }
            finalizeParagraphCache(state, para, currentConfig());
          } catch {
            if (disposed || state.disposed || nextSeg.streamId !== streamId) {
              pacer.cancel();
              break;
            }
            const fallbackText = streamState.text || nextSeg.raw;
            nextSeg.translated = fallbackText;
            nextSeg.status = 'done';
            nextSeg.streamId = '';
            pacer.finish(fallbackText, {
              instant: true,
              onDone: () => {
                para?.el?.removeAttribute?.('data-agy-translate-hidden');
                nextSeg.renderedLen = fallbackText.length;
                nextSeg.pacer = null;
                applyBlockVisibility(state, currentConfig());
                renderPendingTail(state);
              }
            });
          } finally {
            activeStreams.delete(streamId);
          }
        }
      } finally {
        state.running = false;
      }
    }

    function syncBlock(kind, hostEl, anchorEl, bodyHost, nativeMd, rawText, isStreaming, cfg) {
      if (!rawText || (!isStreaming && shouldSkipTranslation(rawText, cfg.targetLang))) return;
      let state = blocks.get(hostEl);
      if (state && !rawText.startsWith(state.lastRawPrefix || '')) {
        cleanupBlockState(state);
        state = null;
      }
      if (!state) {
        state = {
          kind,
          hostEl,
          toggleAnchor: anchorEl,
          bodyHost,
          nativeMd,
          isStreamingBlock: Boolean(isStreaming),
          processedOffset: 0,
          lastRaw: '',
          lastRawPrefix: rawText.slice(0, 48),
          segments: [],
          paragraphs: [],
          pendingTail: '',
          showOriginal: false,
          degradedActive: false,
          running: false,
          disposed: false,
          tailTimer: null,
          mountEl: null,
          segsEl: null,
          tailEl: null,
          toggleWrapEl: null,
          toggleBtn: null,
          degradedDotEl: null
        };
        blocks.set(hostEl, state);
        blockList.add(state);
      } else {
        state.toggleAnchor = anchorEl;
        state.bodyHost = bodyHost;
        state.nativeMd = nativeMd;
        state.isStreamingBlock = state.isStreamingBlock || Boolean(isStreaming);
      }

      ensureBlockUi(state, cfg);

      const textChanged = rawText !== state.lastRaw;
      state.lastRaw = rawText;
      if (textChanged || !isStreaming) {
        const sliced = sliceThinkingSegments(rawText, state.processedOffset, isStreaming);
        appendCommittedPieces(state, sliced);
        state.processedOffset = sliced.nextOffset;
        state.pendingTail = sliced.pendingTail;
        const lastPara = state.paragraphs[state.paragraphs.length - 1];
        if (lastPara && ((!isStreaming && !state.pendingTail.trim()) || (state.pendingTail && hasBlankLineBoundaryBefore(rawText, sliced.nextOffset, state.pendingTail)))) {
          lastPara.closed = true;
        }
        for (const p of state.paragraphs) finalizeParagraphCache(state, p, cfg);
        applyBlockVisibility(state, cfg);
        renderPendingTail(state);
        if (state.tailTimer) { clearTimeout(state.tailTimer); state.tailTimer = null; }
        if (isStreaming && state.pendingTail.trim()) {
          state.tailTimer = setTimeout(() => {
            if (disposed || state.disposed) return;
            const flushed = sliceThinkingSegments(state.lastRaw, state.processedOffset, true, { forceFlushTail: true });
            appendCommittedPieces(state, flushed);
            state.processedOffset = flushed.nextOffset;
            state.pendingTail = '';
            applyBlockVisibility(state, currentConfig());
            renderPendingTail(state);
            void drainBlockQueue(state, currentConfig());
          }, 480);
          state.tailTimer.unref?.();
        }
      }
      if (state.segments.some(s => s.status === 'pending')) {
        void drainBlockQueue(state, cfg);
      }
    }

    function syncThinkingBlocks(cfg) {
      const triggers = [...(doc.querySelectorAll?.('[data-testid="thinking-collapsible-trigger"]') || [])];
      const liveHosts = new Set();
      for (const trig of triggers) {
        const wrapper = trig.parentElement;
        if (!wrapper) continue;
        // Body sibling only mounts when thinking block is expanded!
        const bodyWrapper = [...(wrapper.children || [])].find(c => c !== trig && !c.hasAttribute?.('data-agy-translate-root'));
        const expanded = trig.getAttribute?.('aria-expanded') === 'true' || Boolean(bodyWrapper);
        if (!expanded || !bodyWrapper) {
          const existing = blocks.get(wrapper);
          if (existing) cleanupBlockState(existing);
          continue;
        }
        const nativeMd = bodyWrapper.querySelector?.('[data-markdown-root]') || bodyWrapper.firstElementChild || bodyWrapper;
        const bodyHost = nativeMd?.parentElement || bodyWrapper;
        const visTarget = nativeMd === bodyWrapper ? wrapper : bodyWrapper;
        const existing = blocks.get(wrapper);
        observeVisibility(visTarget);
        const mountVis = existing?.mountEl && !existing.mountEl.hasAttribute?.('data-agy-translate-hidden') ? isElementVisible(existing.mountEl) : false;
        if (!isElementVisible(visTarget) && !mountVis) continue;
        liveHosts.add(wrapper);
        const fiberInfo = readThinkingFiber(trig);
        const rawText = fiberInfo ? fiberInfo.rawText : extractDomMarkdownText(nativeMd);
        const isStreaming = fiberInfo ? fiberInfo.isStreaming : false;
        syncBlock('thinking', wrapper, wrapper, bodyHost, nativeMd, rawText, isStreaming, cfg);
      }
      for (const state of [...blockList]) {
        if (state.kind === 'thinking' && (!state.hostEl.isConnected || !liveHosts.has(state.hostEl))) {
          cleanupBlockState(state);
        }
      }
    }

    function isInsideThinkingBody(el) {
      let cur = el;
      for (let d = 0; cur && d < 5; d++) {
        const parent = cur.parentElement;
        if (parent && [...(parent.children || [])].some(c => c.getAttribute?.('data-testid') === 'thinking-collapsible-trigger')) {
          return true;
        }
        cur = parent;
      }
      return false;
    }

    function syncNarrationBlocks(cfg) {
      const selector = '[data-testid="progress-update-response-text"], [data-testid="agent-response"] [data-testid="planner-response-text"], [data-testid="agent-response"] [data-markdown-root], [data-testid="subagent-tab-conversation"] [data-testid="planner-response-text"], [data-testid="subagent-tab-conversation"] [data-markdown-root]';
      const rawNodes = [...(doc.querySelectorAll?.(selector) || [])];
      const candidates = [];
      for (const el of rawNodes) {
        if (!el.closest?.('[data-testid="agent-response"], [data-testid="subagent-tab-conversation"]')) continue;
        if (el.closest?.('[data-agy-translate-root],[data-testid="user-input-step"],[data-testid="ask-question-entry-readonly"],[data-testid="ask-question-option"],[data-testid="changed-files-card"]')) continue;
        if (isInsideThinkingBody(el)) continue;
        if (el.hasAttribute?.('data-markdown-root')) {
          const outer = el.closest?.('[data-testid="progress-update-response-text"], [data-testid="planner-response-text"]');
          if (outer) continue;
        }
        candidates.push(el);
      }
      const liveHosts = new Set();
      for (const el of candidates) {
        const nativeMd = el.hasAttribute?.('data-markdown-root') ? el : (el.querySelector?.('[data-markdown-root]') || el);
        const bodyHost = nativeMd === el ? (el.parentElement || el) : (nativeMd.parentElement || el);
        const visTarget = nativeMd === el ? bodyHost : el;
        const existing = blocks.get(el);
        observeVisibility(visTarget);
        const mountVis = existing?.mountEl && !existing.mountEl.hasAttribute?.('data-agy-translate-hidden') ? isElementVisible(existing.mountEl) : false;
        if (!isElementVisible(visTarget) && !mountVis) continue;
        const fiberInfo = readNarrationFiber(el);
        // Never translate final main-chat planner answers that didn't use progress-update or subagent pane unless fiber confirms toolCalls.
        const isProgress = el.getAttribute?.('data-testid') === 'progress-update-response-text';
        const inSubagent = Boolean(el.closest?.('[data-testid="subagent-tab-conversation"]'));
        if (!isProgress && !inSubagent && !fiberInfo?.hasTools) continue;
        liveHosts.add(el);
        const rawText = fiberInfo?.rawText || extractDomMarkdownText(nativeMd);
        if (!rawText) continue;
        syncBlock('narration', el, bodyHost, bodyHost, nativeMd, rawText, Boolean(fiberInfo?.isStreaming), cfg);
      }
      for (const state of [...blockList]) {
        if (state.kind === 'narration' && (!state.hostEl.isConnected || !liveHosts.has(state.hostEl))) {
          cleanupBlockState(state);
        }
      }
    }

    function restoreInlineOriginals() {
      for (const [node, entry] of inlineOriginals) {
        if (node.isConnected && node.nodeValue === entry.last) {
          node.nodeValue = entry.original;
        }
        if (entry.hostEl?.isConnected) {
          if (entry.hostEl.getAttribute?.('data-agy-translated') === 'inline') {
            entry.hostEl.removeAttribute?.('data-agy-translated');
          }
          if (entry.hadTip) entry.hostEl.setAttribute?.('data-pt-tip', entry.prevTip);
          else entry.hostEl.removeAttribute?.('data-pt-tip');
        }
      }
      inlineOriginals.clear();
      inlineHostSet.clear();
      pendingInlineQueue.clear();
      if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    }

    function applyInlineTranslation(node, entry, translated, origText, { animate = true } = {}) {
      if (!node?.isConnected) return;
      if (typeof translated !== 'string' || !translated || translated === origText) return;
      const cur = node.nodeValue || '';
      const updated = (entry.prefix || entry.suffix)
        ? `${entry.prefix || ''}${translated.trim()}${entry.suffix || ''}`
        : (cur.includes(origText.trim()) ? cur.replace(origText.trim(), translated.trim()) : translated);
      if (entry.hostEl) {
        entry.hostEl.setAttribute?.('data-agy-translated', 'inline');
        const ancestorTip = entry.hostEl.parentElement?.closest?.('[data-pt-tip]');
        if (!entry.hadTip && entry.hostEl.hasAttribute?.('data-pt-tip')) {
          entry.hadTip = true;
          entry.prevTip = entry.hostEl.getAttribute('data-pt-tip') || '';
        }
        if (!ancestorTip && !entry.hadTip) {
          entry.hostEl.setAttribute?.('data-pt-tip', entry.original.trim());
        }
        if (animate && entry.hostEl.classList && !isReducedMotion() && isStrictlyInViewport(entry.hostEl)) {
          entry.hostEl.classList.remove('agy-tr-inline-reveal');
          void entry.hostEl.offsetWidth;
          entry.hostEl.classList.add('agy-tr-inline-reveal');
          const timer = setTimeout(() => { entry.hostEl?.classList?.remove('agy-tr-inline-reveal'); }, 180);
          timer.unref?.();
        }
      }
      if (node.nodeValue !== updated) node.nodeValue = updated;
      inlineOriginals.set(node, { ...entry, last: updated });
    }

    async function flushInlineBatch() {
      batchTimer = null;
      if (disposed || !pendingInlineQueue.size) return;
      const cfg = currentConfig();
      if (!cfg.active) { pendingInlineQueue.clear(); return; }

      const snapshot = [...pendingInlineQueue.values()];
      pendingInlineQueue.clear();
      const uncached = [];
      for (let i = 0; i < snapshot.length; i++) {
        const item = snapshot[i];
        if (!item.node?.isConnected) continue;
        const cKey = `${cfg.targetLang}|${cfg.engine}|${cfg.baseUrl}|${cfg.model}|inline|${item.query || item.original}`;
        const hit = segmentCache.get(cKey);
        if (hit) {
          applyInlineTranslation(
            item.node,
            { hostEl: item.hostEl, original: item.original, prefix: item.prefix, suffix: item.suffix, hadTip: item.hadTip, prevTip: item.prevTip, last: item.node.nodeValue },
            hit.text,
            item.query || item.original,
            { animate: false }
          );
        } else {
          inFlightInlineNodes.set(item.node, item.original);
          uncached.push({ idx: String(uncached.length), item, cKey });
        }
      }
      if (!uncached.length) return;
      try {
        const batchId = `b-${++batchSeq}`;
        const reply = await request('translate.batch', {
          batchId,
          targetLang: cfg.targetLang,
          items: uncached.map(u => ({ id: u.idx, text: (u.item.query || u.item.original).trim() }))
        });
        if (disposed || cfg.sig !== currentConfig().sig) return;
        const results = Array.isArray(reply?.results) ? reply.results : [];
        for (const res of results) {
          const entry = uncached[Number(res.id)];
          if (!entry || res.error || !res.text || res.skipped) continue;
          rememberSegment(entry.cKey, { text: res.text, provider: res.provider });
          applyInlineTranslation(
            entry.item.node,
            { hostEl: entry.item.hostEl, original: entry.item.original, prefix: entry.item.prefix, suffix: entry.item.suffix, hadTip: entry.item.hadTip, prevTip: entry.item.prevTip, last: entry.item.node.nodeValue },
            res.text,
            entry.item.query || entry.item.original,
            { animate: !res.cached }
          );
        }
      } catch {
        // Leave original inline text untouched on failure.
      } finally {
        for (const u of uncached) {
          if (inFlightInlineNodes.get(u.item.node) === u.item.original) {
            inFlightInlineNodes.delete(u.item.node);
          }
        }
      }
    }

    function syncInlineTools(cfg) {
      const chatScopes = [...(doc.querySelectorAll?.('[data-testid="agent-response"], [data-testid="subagent-tab-conversation"], [data-testid="idle-status-text"], [data-testid="agent-loading"], [data-testid="subagent-node"], [data-testid="background-task-row"], [data-testid="side-question-question"], [data-testid="side-question-row"], [data-testid="browser-subagent-row"], [data-testid="subagent-group-title"], [data-testid="tool-group-collapsible"], .agy-aux-tab-title') || [])];
      const progressScopes = [...(doc.querySelectorAll?.('[data-agy-powertools-root="progress"] .pt-trail-label, [data-agy-powertools-root="progress"] .pt-task-label, [data-agy-powertools-root="progress"] .pt-progress-title, [data-agy-powertools-root="progress"] .pt-progress-sub') || [])];
      let queuedAny = false;
      const visitedNodes = new Set();
      const NF = globalThis.NodeFilter || { SHOW_TEXT: 4 };
      const visitTextNode = (node, { allowProgressRoot = false } = {}) => {
        if (visitedNodes.has(node)) return;
        visitedNodes.add(node);
        const parent = node.parentElement;
        if (!parent) return;
        const inBgTask = Boolean(parent.closest?.('[data-testid="background-task-row"]'));
        const matchedSkip = parent.closest?.(inBgTask ? TOOL_SKIP_BG_TASK_SELECTOR : TOOL_SKIP_SELECTOR);
        if (matchedSkip && !(allowProgressRoot && matchedSkip.getAttribute?.('data-agy-powertools-root') === 'progress')) return;
        if (parent.closest?.(BLOCK_CODE_SKIP_SELECTOR)) return;
        if (parent.closest?.('[data-testid="agy-subagent-badge"]')) return;
        const prev = inlineOriginals.get(node);
        const curVal = node.nodeValue || '';
        const orig = prev && curVal === prev.last ? prev.original : curVal;
        let inlinePrefix = '';
        let inlineSuffix = '';
        let inlineQuery = orig;
        if (allowProgressRoot) {
          const pm = orig.match(/^(\s*(?:子智能体运行中：|子智能體執行中：|等待操作确认：|等待操作確認：|正在执行：|正在執行：|等待批准以))([\s\S]+)$/);
          if (pm) {
            inlinePrefix = pm[1];
            inlineQuery = pm[2];
            const wm = inlineQuery.match(/^((?:蜂群成员|蜂群成員)\s*\()([\s\S]+?)(\)\s*)$/);
            if (wm) {
              inlinePrefix += wm[1];
              inlineQuery = wm[2];
              inlineSuffix = wm[3];
            }
          }
        }
        const trimmed = inlineQuery.trim();
        if (trimmed.length < 4 || trimmed.length > 260) return;
        if (inBgTask && isLikelyShellCommand(trimmed)) return;
        if (shouldSkipTranslation(trimmed, cfg.targetLang)) return;
        observeVisibility(parent);
        if (!isElementVisible(parent)) return;

        const cKey = `${cfg.targetLang}|${cfg.engine}|${cfg.baseUrl}|${cfg.model}|inline|${inlineQuery}`;
        if (prev && curVal === prev.last && segmentCache.has(cKey)) return;
        const hit = segmentCache.get(cKey);
        if (hit) {
          applyInlineTranslation(
            node,
            prev || { original: orig, prefix: inlinePrefix, suffix: inlineSuffix, hostEl: parent, hadTip: Boolean(parent.hasAttribute?.('data-pt-tip')), prevTip: parent.getAttribute?.('data-pt-tip') || '', last: curVal },
            hit.text,
            inlineQuery,
            { animate: false }
          );
          return;
        }
        if (inFlightInlineNodes.get(node) === orig) return;
        if (!pendingInlineQueue.has(node)) {
          pendingInlineQueue.set(node, {
            node,
            original: orig,
            query: inlineQuery,
            prefix: inlinePrefix,
            suffix: inlineSuffix,
            hostEl: parent,
            hadTip: prev ? prev.hadTip : Boolean(parent.hasAttribute?.('data-pt-tip')),
            prevTip: prev ? prev.prevTip : (parent.getAttribute?.('data-pt-tip') || '')
          });
          queuedAny = true;
        }
      };

      for (const scope of chatScopes) {
        observeVisibility(scope);
        if (!doc.createTreeWalker) break;
        const walker = doc.createTreeWalker(scope, NF.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) visitTextNode(node, { allowProgressRoot: false });
      }
      for (const el of progressScopes) {
        observeVisibility(el);
        if (!doc.createTreeWalker) break;
        const walker = doc.createTreeWalker(el, NF.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) visitTextNode(node, { allowProgressRoot: true });
      }
      if (queuedAny && !batchTimer) {
        batchTimer = setTimeout(() => { void flushInlineBatch(); }, 60);
        batchTimer.unref?.();
      }
    }

    function handleEvent(event) {
      if (disposed || !event || typeof event !== 'object') return;
      if (event.type !== 'delta' || typeof event.streamId !== 'string' || !event.delta) return;
      const streamState = activeStreams.get(event.streamId);
      if (!streamState || streamState.segment.status !== 'streaming') return;
      streamState.text += event.delta;
      streamState.sawEvent = true;
      streamState.pacer?.push?.(event.delta);
    }

    function stopObserver() {
      if (domObserver) {
        try { domObserver.disconnect(); } catch {}
        domObserver = null;
      }
    }

    function ensureObserver() {
      if (domObserver || disposed || !doc.body || typeof globalThis.MutationObserver !== 'function') return;
      const IGNORE_SEL = '[data-agy-translate-root],[data-agy-powertools-root]:not([data-agy-powertools-root="progress"]),[data-agy-management-page],[data-testid="user-input-step"],[data-testid="agent-input-box"],[contenteditable],textarea,input,.pt-tip-pop';
      domObserver = new globalThis.MutationObserver(records => {
        if (disposed) return;
        for (const record of records) {
          if (record.type === 'characterData') {
            const entry = inlineOriginals.get(record.target);
            if (entry && entry.last === record.target.nodeValue) continue;
          }
          const t = record.type === 'characterData' ? record.target?.parentElement : record.target;
          if (!t || t.closest?.(IGNORE_SEL)) continue;
          if (record.attributeName && String(record.attributeName).startsWith('data-agy-translate')) continue;
          scheduleSync(60);
          return;
        }
      });
      try {
        domObserver.observe(doc.body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['aria-expanded']
        });
      } catch {
        domObserver = null;
      }
    }

    function resetAllTranslations() {
      stopObserver();
      for (const id of [...activeStreams.keys()]) abortStream(id);
      for (const state of [...blockList]) cleanupBlockState(state);
      restoreInlineOriginals();
    }

    function sync() {
      if (disposed) return;
      const cfg = currentConfig();
      if (cfg.sig !== lastConfigSig) {
        lastConfigSig = cfg.sig;
        resetAllTranslations();
      }
      if (!cfg.active) return;
      ensureStyle();
      ensureObserver();
      syncThinkingBlocks(cfg);
      syncNarrationBlocks(cfg);
      syncInlineTools(cfg);
    }

    function scheduleSync(delay = 60) {
      if (disposed || syncTimer) return;
      syncTimer = setTimeout(() => {
        syncTimer = null;
        sync();
      }, delay);
      syncTimer.unref?.();
    }

    function dispose() {
      disposed = true;
      if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
      resetAllTranslations();
      io?.disconnect?.();
      styleEl?.remove?.();
      styleEl = null;
      segmentCache.clear();
    }

    return { sync, scheduleSync, handleEvent, dispose };
  }

  globalThis.__agyDetailTranslator = createDetailTranslator;
  globalThis.__agyDetailTranslatorHelpers = {
    shouldSkipTranslation,
    sliceThinkingSegments,
    renderMarkdownInto,
    extractDomMarkdownText,
    tokenizeForFlow
  };
})();
