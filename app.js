/* ENGL 101 Paragraph Grader
 * Credits: Prof. Ahmad Motie Hamaidi & Ashraf Ahmad Motie Hamaidi
 *
 * Pure front-end app (works on GitHub Pages). The photo is sent from the
 * teacher's browser straight to the Anthropic Messages API using the
 * teacher's own API key. Nothing is stored on any server.
 */
(function () {
  'use strict';

  var API_URL = 'https://api.anthropic.com/v1/messages';
  var MAX_DIM = 1568;          // longest image side sent to the model
  var CRITERIA = [
    { key: 'content',      label: 'Content' },
    { key: 'organization', label: 'Organization' },
    { key: 'grammar',      label: 'Syntax & Grammar' },
    { key: 'vocabulary',   label: 'Vocabulary & Idioms' },
    { key: 'mechanics',    label: 'Spelling & Mechanics' }
  ];

  /* Same formula as the WP1 sheet:  =SUM(D12:H12)/50*7.5  */
  function wp1Mark(total) { return total / 50 * 7.5; }

  /* ---------- rubric text given to the model ---------- */
  var SYSTEM_PROMPT = [
    'You are an experienced ENGL 101 writing instructor at Imam Abdulrahman Bin Faisal University (Preparatory Year, Department of English Language).',
    'You grade a student\'s handwritten or typed PARAGRAPH from a photo, using ONLY the official "ENGL 101 Writing Portfolio | Paragraph Writing Rubric" below.',
    'Five criteria, each scored with a WHOLE number from 0 to 10 (total out of 50).',
    '',
    'BAND GUIDE (use the band to choose the score; 8 belongs to the top band, 6-7 second, 4-5 third, 0-3 lowest):',
    '',
    'CONTENT',
    ' 8-10: Fully on topic, reads like original production. Topic sentence connected to the 3 subtopics. 3 subtopics stated in 2 sentences each. Conclusion at end; refers back to topic sentence.',
    ' 6-7: Slightly off topic and/or fewer than 6 sentences. Topic sentence does not control paragraph. Conclusion not connected to topic sentence or supporting ideas.',
    ' 4-5: Off topic and/or fewer than 4 sentences. Irrelevant or absent subtopics. Missing topic sentence or conclusion.',
    ' 0-3: Off topic but demonstrates effort. 2-4 sentences.',
    '',
    'ORGANIZATION',
    ' 8-10: Topic sentence at beginning. Order of subtopics follows a discernible pattern (e.g. chronological). Concluding sentence at end.',
    ' 6-7: Major paragraph elements present but not organized by a clear pattern and/or lack required elements.',
    ' 4-5: Some paragraph elements present but they lack organization.',
    ' 0-3: No paragraph organization and/or no demonstration of the basics of organization.',
    '',
    'SYNTAX & GRAMMAR',
    ' 8-10: Minimal subject-verb errors; errors do not interfere with comprehension; few errors with verb tense, auxiliaries, word order or sentence structure.',
    ' 6-7: Overall comprehensible; S-V agreement errors are rare; errors in verb tense/aspect and other grammar errors only occasional.',
    ' 4-5: Difficult to understand because of grammar errors; S-V and sentence-structure errors are common; difficult to understand because of weak sentence formation.',
    ' 0-3: Unable to form a correct sentence or produce correct S-V agreement; large parts fail to convey meaning.',
    '',
    'VOCABULARY & IDIOMS',
    ' 8-10: Correct usage; level-appropriate vocabulary, use of Unit vocabulary; correct parts of speech.',
    ' 6-7: Uses some appropriate vocabulary from relevant lesson content; some incorrectly used words/expressions but not interfering with overall comprehension.',
    ' 4-5: Noticeably incorrect usage; vocabulary below expected level; noticeably limited.',
    ' 0-3: Uses many words incorrectly; relies on excessively elementary vocabulary.',
    '',
    'SPELLING & MECHANICS (count errors in spelling, capitalization, punctuation; an incorrectly spelled word counts once):',
    ' 0-6 errors -> 8-10;  7-8 errors -> 6-7;  9-12 errors -> 4-5;  13-16 errors -> 0-3;  more than 16 errors -> 0.',
    ' Count the errors carefully and list them. Within a band, fewer errors = higher score (e.g. 0-2 errors = 10, 3-4 = 9, 5-6 = 8).',
    '',
    'SPECIAL RULES:',
    ' * If the writing is off topic but shows effort, the TOTAL must be no more than 10 and no fewer than 3 out of 50. Set special_rule = "off_topic_effort".',
    ' * If the student wrote fewer than 2 sentences, give 0 for everything. Set special_rule = "under_two_sentences".',
    ' * Plagiarized or memorized off-topic production must receive ZERO. You cannot verify plagiarism, so if the text looks copied, memorized, or unnaturally advanced for the level, set special_rule = "plagiarism_suspected" but still score it honestly; the teacher will decide.',
    ' * Otherwise special_rule = "none".',
    '',
    'PROCEDURE:',
    '1. Transcribe the writing EXACTLY as written, preserving the student\'s errors (do NOT correct them). Mark unreadable words as [illegible]. Join multiple photos in order.',
    '2. Count sentences and list spelling/capitalization/punctuation errors (original form -> correction).',
    '3. If an assigned topic / subtopics / unit vocabulary is provided, judge Content and Vocabulary against it. If none is provided, infer the topic from the topic sentence and say you did so.',
    '4. Score each criterion and explain WHY in 2-3 plain sentences that name the rubric band reached and cite short quotes from the student\'s text as evidence. Be fair, consistent and concrete; do not inflate or deflate.',
    '5. Give 2-3 short, actionable suggestions for the student.',
    'If the photo is too blurry/unreadable to grade, set legibility_warning explaining what is wrong and grade only what you can read.',
    'Always respond by calling the submit_grade tool.'
  ].join('\n');

  var reasonSchema = {
    type: 'object',
    properties: {
      score: { type: 'integer', minimum: 0, maximum: 10 },
      band: { type: 'string', description: 'Rubric band reached, e.g. "6-7"' },
      why: { type: 'string', description: '2-3 sentences explaining the score against the rubric' },
      evidence: { type: 'array', items: { type: 'string' }, description: 'Short quotes from the student text' }
    },
    required: ['score', 'band', 'why', 'evidence']
  };

  var TOOL = {
    name: 'submit_grade',
    description: 'Submit the rubric-based grade for the student paragraph.',
    input_schema: {
      type: 'object',
      properties: {
        transcription: { type: 'string' },
        legibility_warning: { type: 'string', description: 'Empty string if the writing is readable' },
        detected_topic: { type: 'string' },
        sentence_count: { type: 'integer' },
        spelling_error_count: { type: 'integer' },
        spelling_errors: { type: 'array', items: { type: 'string' } },
        special_rule: { type: 'string', enum: ['none', 'off_topic_effort', 'under_two_sentences', 'plagiarism_suspected'] },
        special_rule_note: { type: 'string' },
        content: reasonSchema,
        organization: reasonSchema,
        grammar: reasonSchema,
        vocabulary: reasonSchema,
        mechanics: reasonSchema,
        overall_comment: { type: 'string' },
        suggestions: { type: 'array', items: { type: 'string' } }
      },
      required: ['transcription', 'legibility_warning', 'detected_topic', 'sentence_count', 'spelling_error_count',
        'spelling_errors', 'special_rule', 'special_rule_note', 'content', 'organization', 'grammar',
        'vocabulary', 'mechanics', 'overall_comment', 'suggestions']
    }
  };

  /* ---------- helpers ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function load(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
  function bandOf(score) { return score >= 8 ? '8-10' : score >= 6 ? '6-7' : score >= 4 ? '4-5' : '0-3'; }

  var images = [];   // {url, base64, mediaType}
  var result = null; // last tool output

  /* ---------- settings ---------- */
  $('apiKey').value = load('wg_key');
  if (load('wg_model')) $('model').value = load('wg_model');
  $('apiKey').addEventListener('change', function () { store('wg_key', this.value.trim()); updateBtn(); });
  $('model').addEventListener('change', function () { store('wg_model', this.value.trim()); });

  /* ---------- image intake ---------- */
  var dz = $('dropzone'), fi = $('fileInput');
  dz.addEventListener('click', function () { fi.click(); });
  dz.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fi.click(); } });
  ['dragenter', 'dragover'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('drag'); });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('drag'); });
  });
  dz.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
  fi.addEventListener('change', function () { addFiles(fi.files); fi.value = ''; });
  document.addEventListener('paste', function (e) {
    if (e.clipboardData && e.clipboardData.files.length) addFiles(e.clipboardData.files);
  });

  function addFiles(list) {
    Array.prototype.forEach.call(list, function (f) {
      if (!/^image\//.test(f.type)) return;
      prepareImage(f).then(function (img) { images.push(img); renderThumbs(); updateBtn(); })
        .catch(function () { setStatus('Could not read "' + f.name + '". Try a JPG or PNG photo.', 'error'); });
    });
  }

  function prepareImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var s = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        var data = c.toDataURL('image/jpeg', 0.88);
        URL.revokeObjectURL(url);
        resolve({ url: data, base64: data.split(',')[1], mediaType: 'image/jpeg' });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  function renderThumbs() {
    var box = $('thumbs'); box.innerHTML = '';
    images.forEach(function (im, i) {
      var d = document.createElement('div'); d.className = 'thumb';
      d.innerHTML = '<img alt="Page ' + (i + 1) + '" src="' + im.url + '"><button type="button" aria-label="Remove photo">&times;</button>';
      d.querySelector('button').addEventListener('click', function () { images.splice(i, 1); renderThumbs(); updateBtn(); });
      box.appendChild(d);
    });
  }

  function updateBtn() { $('gradeBtn').disabled = !(images.length && $('apiKey').value.trim()); }
  function setStatus(msg, kind) { var s = $('status'); s.textContent = msg; s.className = kind || ''; }

  $('clearBtn').addEventListener('click', function () {
    images = []; result = null; renderThumbs(); updateBtn(); setStatus('');
    $('result-card').hidden = true; $('report').innerHTML = '';
    ['studentName', 'studentId', 'topic'].forEach(function (id) { $(id).value = ''; });
  });

  /* ---------- grading ---------- */
  $('gradeBtn').addEventListener('click', grade);

  function grade() {
    var key = $('apiKey').value.trim(), model = $('model').value.trim() || 'claude-sonnet-5-5';
    store('wg_key', key); store('wg_model', model);
    var topic = $('topic').value.trim();

    var content = images.map(function (im) {
      return { type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.base64 } };
    });
    content.push({
      type: 'text',
      text: (images.length > 1 ? 'The ' + images.length + ' photos above are consecutive pages of ONE paragraph.\n' : '') +
        'Assigned topic / subtopics / unit vocabulary: ' + (topic || '(not provided)') + '\n\nGrade this student writing with the rubric.'
    });

    $('gradeBtn').disabled = true;
    setStatus('Reading and grading the writing... this usually takes 15-40 seconds.', 'busy');

    fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: model,
        max_tokens: 6000,
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        tool_choice: { type: 'tool', name: 'submit_grade' },
        messages: [{ role: 'user', content: content }]
      })
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error((j && j.error && j.error.message) || ('HTTP ' + r.status));
        return j;
      });
    }).then(function (j) {
      var block = (j.content || []).filter(function (b) { return b.type === 'tool_use'; })[0];
      if (!block) throw new Error('The model did not return a grade. Please try again.');
      result = block.input;
      render();
      setStatus('Done.');
      $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (err) {
      setStatus('Error: ' + err.message, 'error');
    }).then(function () { updateBtn(); });
  }

  /* ---------- rules + totals (mirrors the rubric and the WP1 sheet) ---------- */
  function currentScores() {
    var s = {};
    CRITERIA.forEach(function (c) {
      var el = $('score-' + c.key);
      s[c.key] = el ? clamp(Math.round(Number(el.value) || 0), 0, 10) : 0;
    });
    return s;
  }

  function applyRules(raw) {
    var out = {}, note = '';
    var zero = false;
    if (result.special_rule === 'under_two_sentences') { zero = true; note = 'Fewer than 2 sentences were written, so the entire production receives 0 marks.'; }
    var pl = $('plagiarized');
    if (pl && pl.checked) { zero = true; note = 'Marked as plagiarized / memorized off-topic production: ZERO points.'; }
    CRITERIA.forEach(function (c) { out[c.key] = zero ? 0 : raw[c.key]; });

    var total = CRITERIA.reduce(function (a, c) { return a + out[c.key]; }, 0);
    if (!zero && result.special_rule === 'off_topic_effort') {
      var target = clamp(total, 3, 10);
      if (target !== total) {
        // scale proportionally, then nudge one point at a time until the total is exact
        var f = total ? target / total : 0;
        CRITERIA.forEach(function (c) { out[c.key] = Math.round(out[c.key] * f); });
        var sum = function () { return CRITERIA.reduce(function (a, c) { return a + out[c.key]; }, 0); };
        var i = 0;
        while (sum() !== target && i++ < 200) {
          var k = CRITERIA[i % CRITERIA.length].key;
          if (sum() < target && out[k] < 10) out[k]++;
          else if (sum() > target && out[k] > 0) out[k]--;
        }
        total = sum();
      }
      note = 'Off topic but shows effort: total is limited to between 3 and 10 marks out of 50.';
    }
    return { scores: out, total: total, note: note, zeroed: zero };
  }

  function updateTotals() {
    var raw = currentScores();
    var r = applyRules(raw);
    $('tot50').textContent = r.total;
    $('totPct').textContent = Math.round(r.total / 50 * 100) + '%';
    $('totWp').textContent = wp1Mark(r.total).toFixed(2);
    CRITERIA.forEach(function (c) {
      var b = $('band-' + c.key); if (b) b.textContent = 'Band ' + bandOf(raw[c.key]);
    });
    var n = $('ruleNote');
    if (n) { n.textContent = r.note; n.parentElement.hidden = !r.note && !(result.special_rule === 'plagiarism_suspected'); }
  }

  /* ---------- report ---------- */
  function render() {
    var d = result;
    var name = $('studentName').value.trim(), id = $('studentId').value.trim(), wp = $('wpNumber').value;
    var today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    var h = '';
    h += '<div class="student-meta">' +
      '<span>Student: <strong>' + esc(name || '—') + '</strong></span>' +
      '<span>ID: <strong>' + esc(id || '—') + '</strong></span>' +
      '<span>Portfolio: <strong>' + esc(wp) + '</strong></span>' +
      '<span>Date: <strong>' + esc(today) + '</strong></span></div>';

    h += '<div class="score-banner">' +
      '<div><div class="lbl">Rubric total</div><div class="big"><span id="tot50">0</span><small> / 50</small></div></div>' +
      '<div><div class="lbl">Percentage</div><div class="big" id="totPct">0%</div></div>' +
      '<div><div class="lbl">Total ' + esc(wp) + ' (gradebook)</div><div class="big"><span id="totWp">0.00</span><small> / 7.5</small></div></div>' +
      '</div>';

    if (d.legibility_warning) {
      h += '<div class="notice"><strong>Legibility warning:</strong> ' + esc(d.legibility_warning) + '</div>';
    }

    var flagged = d.special_rule && d.special_rule !== 'none';
    h += '<div class="notice' + (d.special_rule === 'plagiarism_suspected' || d.special_rule === 'under_two_sentences' ? ' bad' : '') + '"' +
      (flagged ? '' : ' hidden') + '>' +
      '<strong id="ruleNote"></strong>' +
      (d.special_rule_note ? '<div>' + esc(d.special_rule_note) + '</div>' : '') +
      (d.special_rule === 'plagiarism_suspected' ?
        '<div>The AI suspects copied or memorized work. It cannot verify this.</div>' : '') +
      '<label class="no-print"><input type="checkbox" id="plagiarized"> Confirm plagiarized / memorized off-topic work (give ZERO)</label></div>';

    h += '<div class="criteria">';
    CRITERIA.forEach(function (c) {
      var r = d[c.key] || { score: 0, band: '', why: '', evidence: [] };
      var sc = clamp(Math.round(Number(r.score) || 0), 0, 10);
      h += '<div class="criterion">' +
        '<div><h3>' + c.label + '</h3><div class="band" id="band-' + c.key + '">Band ' + esc(r.band || bandOf(sc)) + '</div></div>' +
        '<div class="score-box"><input type="number" min="0" max="10" step="1" id="score-' + c.key + '" value="' + sc + '" aria-label="' + c.label + ' score"><span>out of 10</span></div>' +
        '<p class="why">' + esc(r.why) + '</p>' +
        ((r.evidence && r.evidence.length) ? '<ul class="evidence">' + r.evidence.map(function (q) { return '<li><q>' + esc(q) + '</q></li>'; }).join('') + '</ul>' : '') +
        '</div>';
    });
    h += '</div>';
    h += '<p class="hint no-print">You can change any score above; the totals update automatically. The wording of the reasons is the AI\'s original explanation.</p>';

    h += '<div class="block"><h3>Overall comment</h3><p>' + esc(d.overall_comment) + '</p>' +
      (d.suggestions && d.suggestions.length ? '<ul>' + d.suggestions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>' : '') + '</div>';

    h += '<div class="block"><h3>Sentences &amp; spelling check</h3>' +
      '<p>Sentences counted: <strong>' + esc(d.sentence_count) + '</strong> &middot; Spelling / capitalization / punctuation errors: <strong>' + esc(d.spelling_error_count) + '</strong>' +
      (d.detected_topic ? ' &middot; Topic understood as: <em>' + esc(d.detected_topic) + '</em>' : '') + '</p>' +
      ((d.spelling_errors && d.spelling_errors.length) ? '<div class="chips">' + d.spelling_errors.map(function (e) { return '<span class="chip">' + esc(e) + '</span>'; }).join('') + '</div>' : '') +
      '</div>';

    h += '<div class="block"><h3>Transcription of the student\'s writing</h3><pre class="transcript">' + esc(d.transcription) + '</pre>' +
      '<p class="hint">Transcribed exactly as written (errors kept). Check it against the photo if a score looks wrong.</p></div>';

    $('report').innerHTML = h;
    $('result-card').hidden = false;

    CRITERIA.forEach(function (c) { $('score-' + c.key).addEventListener('input', updateTotals); });
    var pl = $('plagiarized'); if (pl) pl.addEventListener('change', updateTotals);
    updateTotals();
  }

  $('printBtn').addEventListener('click', function () { window.print(); });

  updateBtn();
})();
