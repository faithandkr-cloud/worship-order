// ══════════════════════════════════════════════
  // 성경 데이터 저장소 — 성경읽기_mobile.html과 완전히 같은 방식
  // (IndexedDB 'BibleAppStore'의 'files' 스토어, 키는 'bible:번역본이름',
  // 값은 마이스워드(.mybible) SQLite 파일의 원본 바이너리).
  // 이렇게 맞춰두면 성경읽기_mobile.html 등에서 이미 불러와 둔 성경을
  // 이 예배순서지도 별도 작업 없이 그대로 찾아 쓸 수 있다(같은 주소로 열었을 때).
  const AppDB = (() => {
    const DB_NAME = 'BibleAppStore';
    const DB_VER = 1;
    let _db = null;
    function open() {
      if (_db) return Promise.resolve(_db);
      return new Promise((res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'key' });
        };
        req.onsuccess = e => { _db = e.target.result; res(_db); };
        req.onerror = e => rej(e);
      });
    }
    async function save(key, data, meta) {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put({ key, data, meta: meta || {}, savedAt: Date.now() });
        tx.oncomplete = () => res(true);
        tx.onerror = e => rej(e);
      });
    }
    async function load(key) {
      const db = await open();
      return new Promise((res, rej) => {
        const tx = db.transaction('files', 'readonly');
        const req = tx.objectStore('files').get(key);
        req.onsuccess = () => res(req.result || null);
        req.onerror = e => rej(e);
      });
    }
    return { save, load };
  })();

  // 66권 book number -> 한글 이름 (성경읽기_mobile.html과 동일)
  const BOOK_FALLBACK = {1:'창세기',2:'출애굽기',3:'레위기',4:'민수기',5:'신명기',6:'여호수아',7:'사사기',8:'룻기',9:'사무엘상',10:'사무엘하',11:'열왕기상',12:'열왕기하',13:'역대상',14:'역대하',15:'에스라',16:'느헤미야',17:'에스더',18:'욥기',19:'시편',20:'잠언',21:'전도서',22:'아가',23:'이사야',24:'예레미야',25:'예레미야애가',26:'에스겔',27:'다니엘',28:'호세아',29:'요엘',30:'아모스',31:'오바댜',32:'요나',33:'미가',34:'나훔',35:'하박국',36:'스바냐',37:'학개',38:'스가랴',39:'말라기',40:'마태복음',41:'마가복음',42:'누가복음',43:'요한복음',44:'사도행전',45:'로마서',46:'고린도전서',47:'고린도후서',48:'갈라디아서',49:'에베소서',50:'빌립보서',51:'골로새서',52:'데살로니가전서',53:'데살로니가후서',54:'디모데전서',55:'디모데후서',56:'디도서',57:'빌레몬서',58:'히브리서',59:'야고보서',60:'베드로전서',61:'베드로후서',62:'요한1서',63:'요한2서',64:'요한3서',65:'유다서',66:'요한계시록'};
  const BOOK_ABBR = {1:'창',2:'출',3:'레',4:'민',5:'신',6:'수',7:'삿',8:'룻',9:'삼상',10:'삼하',11:'왕상',12:'왕하',13:'대상',14:'대하',15:'스',16:'느',17:'에',18:'욥',19:'시',20:'잠',21:'전',22:'아',23:'사',24:'렘',25:'애',26:'겔',27:'단',28:'호',29:'욜',30:'암',31:'옵',32:'욘',33:'미',34:'나',35:'합',36:'습',37:'학',38:'슥',39:'말',40:'마',41:'막',42:'눅',43:'요',44:'행',45:'롬',46:'고전',47:'고후',48:'갈',49:'엡',50:'빌',51:'골',52:'살전',53:'살후',54:'딤전',55:'딤후',56:'딛',57:'몬',58:'히',59:'약',60:'벧전',61:'벧후',62:'요일',63:'요이',64:'요삼',65:'유',66:'계'};
  // 이름 -> 번호 역방향 맵(정식 이름과 약칭 모두 인식)
  const BOOK_NAME_TO_NUM = {};
  Object.entries(BOOK_FALLBACK).forEach(([n, name]) => { BOOK_NAME_TO_NUM[name] = Number(n); });
  Object.entries(BOOK_ABBR).forEach(([n, abbr]) => { if (!(abbr in BOOK_NAME_TO_NUM)) BOOK_NAME_TO_NUM[abbr] = Number(n); });

  function stripMyswordExt(filename) {
    // .bbl.mybible / .mybible 같은 이중 확장자가 기기마다 다르게 매칭되는 문제가
    // 있어, 대신 "첫 번째 마침표 앞부분"만 이름으로 사용한다(성경읽기_mobile.html과 동일).
    const i = (filename || "").indexOf('.');
    return i === -1 ? filename : filename.slice(0, i);
  }

  let SQLJS = null, SQLJS_PROMISE = null;
  async function ensureSqlJs() {
    if (SQLJS) return SQLJS;
    if (!SQLJS_PROMISE) SQLJS_PROMISE = initSqlJs({ locateFile: f => './' + f });
    SQLJS = await SQLJS_PROMISE;
    return SQLJS;
  }

  const BIBLE_DBS = {};
  const BIBLE_CHAPTER_CACHE = {};

  async function loadBibleDB(key) {
    if (BIBLE_DBS[key]) return BIBLE_DBS[key];
    try {
      const rec = await AppDB.load('bible:' + key);
      if (!rec || !rec.data) return null;
      const SQL = await ensureSqlJs();
      const db = new SQL.Database(new Uint8Array(rec.data));
      BIBLE_DBS[key] = db;
      return db;
    } catch (e) { console.error('성경 DB 열기 실패:', key, e); return null; }
  }

  async function loadBibleChapter(key, book, chapter) {
    const ck = key + '_' + book + '_' + chapter;
    if (BIBLE_CHAPTER_CACHE[ck]) return BIBLE_CHAPTER_CACHE[ck];
    const db = await loadBibleDB(key);
    if (!db) return null;
    try {
      const stmt = db.prepare('SELECT Verse, Scripture FROM Bible WHERE Book=? AND Chapter=? ORDER BY Verse');
      stmt.bind([book, chapter]);
      const out = {};
      while (stmt.step()) { const row = stmt.getAsObject(); out[String(row.Verse)] = row.Scripture; }
      stmt.free();
      BIBLE_CHAPTER_CACHE[ck] = out;
      return out;
    } catch (e) { console.error('성경 본문 조회 실패:', e); return null; }
  }

  // ── 성경 출처 표기를 해석해서 본문을 찾아온다 ──────────────
  // "디모데후서 4:7~8" / "디모데후서 4:7-8" / "요한복음 4장 23~24절" 등
  // 콜론 표기와 한글 표기를 모두 지원한다. 같은 장 범위만 지원(여러 장에
  // 걸친 범위는 지원하지 않음 — 대부분의 예배 본문은 한 장 안에서 끝남).

  // 탭을 여러 개 열어두고 쓰는 경우가 많아서(예: 설정 탭에서 방금 연결했는데
  // 예배 순서 탭은 그 전에 이미 열려있던 경우), 변수 하나에 값을 캐시해두면
  // 다른 탭에서 새로 연결한 내용을 이 탭이 못 보고 "연결 안 됨"으로 나온다.
  // 그래서 매번 localStorage에서 직접 다시 읽어와 항상 최신 상태를 본다.
  function getActiveBibleVerId() {
    try { return localStorage.getItem("cdyb_bible_verid") || ""; } catch (e) { return ""; }
  }

  function setActiveBibleVerId(verId) {
    try { localStorage.setItem("cdyb_bible_verid", verId); } catch (e) {}
  }

  function parseScriptureRef(ref) {
    if (!ref) return null;
    const text = ref.trim();
    let m = text.match(/^(.+?)\s*(\d+)\s*:\s*(\d+)(?:\s*[~\-]\s*(\d+))?\s*$/);
    if (m) return { book: m[1].trim(), chapter: Number(m[2]), start: Number(m[3]), end: m[4] ? Number(m[4]) : Number(m[3]) };
    m = text.match(/^(.+?)\s*(\d+)\s*장\s*(\d+)(?:\s*[~\-]\s*(\d+))?\s*절?\s*$/);
    if (m) return { book: m[1].trim(), chapter: Number(m[2]), start: Number(m[3]), end: m[4] ? Number(m[4]) : Number(m[3]) };
    return null;
  }

  // 마지막으로 실패한 이유를 담아둔다(호출부에서 사용자에게 구체적으로 안내하기 위함).
  let lastScriptureLookupError = "";

  async function lookupScriptureRange(parsed) {
    const bookNum = BOOK_NAME_TO_NUM[parsed.book];
    if (!bookNum) {
      lastScriptureLookupError = `"${parsed.book}"라는 책 이름을 인식하지 못했습니다. 정식 이름(예: 사도행전)이나 약칭(예: 행)으로 입력해주세요.`;
      return null;
    }
    const verses = await loadBibleChapter(getActiveBibleVerId(), bookNum, parsed.chapter);
    if (!verses) {
      lastScriptureLookupError = "성경 DB를 여는 데 실패했습니다. '성경 데이터 연결'에서 번역본을 다시 연결해보세요.";
      return null;
    }
    if (!Object.keys(verses).length) {
      lastScriptureLookupError = `연결된 번역본에서 ${parsed.book} ${parsed.chapter}장 본문을 찾지 못했습니다. 이 번역본에 해당 책이 들어있는지 확인해주세요.`;
      return null;
    }
    const lines = [];
    for (let v = parsed.start; v <= parsed.end; v++) {
      if (verses[String(v)]) lines.push(`${v}  ${verses[String(v)]}`);
    }
    if (!lines.length) {
      lastScriptureLookupError = `${parsed.book} ${parsed.chapter}장에서 ${parsed.start}~${parsed.end}절을 찾지 못했습니다. 절 번호를 확인해주세요.`;
      return null;
    }
    return lines.join("\n");
  }

  // force가 없으면 이미 본문이 있는 항목은 건드리지 않는다(수동 편집 보호).
  async function autofillScriptureText(idx, panel, { force } = {}) {
    lastScriptureLookupError = "";
    const item = draftItems[idx];
    if (!item || !item.scriptureRef) return false;
    if (!force && item.scriptureText && item.scriptureText.trim()) return false;
    if (!getActiveBibleVerId()) {
      lastScriptureLookupError = "성경 데이터가 연결되어 있지 않습니다. 설정 상단 '성경 데이터 연결'에서 번역본을 먼저 연결해주세요.";
      return false;
    }
    const parsed = parseScriptureRef(item.scriptureRef);
    if (!parsed) {
      lastScriptureLookupError = "성경주소 표기를 인식하지 못했습니다. 예: 사도행전 2:11~17 또는 사도행전 2장 11~17절";
      return false;
    }
    const text = await lookupScriptureRange(parsed);
    if (!text) return false;
    draftItems[idx].scriptureText = text;
    if (panel) {
      const textarea = panel.querySelector(".scripture-text-input");
      if (textarea) textarea.value = text;
    }
    return true;
  }

  // ══════════════════════════════════════════════
  // 찬송가 악보 이미지 저장소 — 찬송가.html과 완전히 같은 방식(IndexedDB
  // 'hymnDB'의 'images' 스토어, 키는 장 번호, 값은 사진 파일 그대로).
  // 이렇게 맞춰두면 찬송가.html에서 이미 불러와 둔 사진을 이 예배순서지도
  // 별도 작업 없이 그대로 찾아 쓸 수 있다(같은 주소로 열었을 때).
  const HymnImageDB = (() => {
    const DB_NAME = 'hymnDB';
    const STORE   = 'images';

    function openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      });
    }

    // key: 숫자(장 번호)면 정수로, 제목(CCM 등 번호 없는 곡)이면 문자열 그대로 사용.
    // val: 사진 File/Blob 그 자체(dataURL로 변환하지 않는다 — 찬송가.html과 동일).
    async function save(key, blob) {
      const db = await openDB();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = res;
        tx.onerror    = e => rej(e.target.error);
      });
      db.close();
    }

    async function load(key) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result || null); };
        req.onerror   = e => { db.close(); reject(e.target.error); };
      });
    }

    async function count() {
      const db = await openDB();
      return new Promise((resolve) => {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror   = () => { db.close(); resolve(0); };
      });
    }

    return { save, load, count };
  })();

  // 찬송가.html과 동일한 규칙: 파일명에서 "숫자+장" 우선, 없으면 첫 숫자열을 장 번호로 삼는다.
  function parseHymnNumber(filename) {
    let m = filename.match(/(\d+)\s*장/);
    if (m) return parseInt(m[1], 10);
    m = filename.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  // ══════════════════════════════════════════════
  // 예배 데이터 모델
  //
  // 순서 항목(item)은 아래 필드를 가진다.
  //   num, sub        : 목록 번호 / 하위 항목 여부
  //   title, desc     : 목록에 표시되는 제목·설명
  //   type            : "일반" | "성경말씀" | "성경본문" | "찬송" | "설교"
  //   content         : 본문 내용(빈 줄로 문단 구분) — 일반/성경말씀/설교에서 사용
  //   scriptureRef/Text/First : 성경 관련 데이터 — 성경말씀/성경본문/설교에서 사용
  //     (scriptureFirst는 성경말씀에서만 의미가 있음: 성경본문은 항상 성경만,
  //      설교는 항상 성경이 내용보다 앞에 고정)
  //   hymnNum/hymnCaption/hymnImage : 찬송 관련 데이터
  //
  //   유형이 "설교"이거나 "성경본문"인 항목은 유형이 고정되어 있어 설정 화면에
  //   "유형" 선택칸이 나타나지 않는다(자주 쓰는 순서 버튼으로만 만들어진다).
  // ══════════════════════════════════════════════

  // 로컬 저장 키에 이 파일의 경로(location.pathname)를 포함시킨다.
  // (예전에는 모든 예배순서지 파일이 이 값을 똑같이 썼는데, 같은 도메인
  // 에서 열면 localStorage가 도메인 단위로 공유되기 때문에 한 파일에서
  // "저장하기"를 누르면 다른 예배순서지까지 그 내용으로 덮어
  // 써지는 문제가 있었다. 파일마다 다른 키를 쓰도록 고쳐서 서로 완전히
  // 분리되게 했다.)
  const STORAGE_KEY = "cdyb_order_service_data_v1:" + (location.pathname || "unknown");

  const defaultServiceTitle = "주일오전예배";

  // 문단마다 별도 블록으로 나눠야 페이지 계산이 정확해진다 — 빈 줄 기준으로 분리.
  function paragraphs(text, className) {
    className = className || "para";
    return (text || "")
      .split(/\n\s*\n/)
      .map(t => t.trim())
      .filter(Boolean)
      .map(t => `<p class="${className}">${t.replace(/\n/g, '<br>')}</p>`);
  }

  // 설교문(원고)처럼 문단 사이에 빈 줄 없이 통째로 붙여넣는 긴 글을 위한
  // 블록 분리. paragraphs()는 빈 줄 기준으로만 나누기 때문에, 원고 전체가
  // 빈 줄 하나 없이 붙여넣어지면 "문단 하나"로 인식돼 페이지를 나눌 수 있는
  // 단위가 아예 없어져 버린다(그래서 페이지 배분을 아무리 고쳐도 설교문만
  // 그대로였다). 문단 안에서도 줄 단위로 쪼개어, 문단의 마지막 줄에만 문단
  // 간격을 주고 나머지 줄은 간격 없이 이어 붙이면, 화면에 보이는 모습은
  // 기존과 똑같이 유지하면서도 페이지는 줄 단위로 끊을 수 있게 된다.
  function sermonTextBlocks(text) {
    const blocks = [];
    (text || "")
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean)
      .forEach(paragraph => {
        const lines = paragraph.split("\n").map(l => l.trim());
        lines.forEach((line, i) => {
          const isLastLine = i === lines.length - 1;
          blocks.push(`<p class="para${isLastLine ? "" : " para-line"}">${line}</p>`);
        });
      });
    return blocks;
  }

  function textToBr(text) {
    return (text || "").trim().replace(/\n/g, "<br>\n");
  }

  // escapeText는 이 함수 아래(설정 화면 쪽)에 정의되어 있지만 함수 선언은
  // 호이스팅되므로 여기서 먼저 써도 된다.

  // 교독문 본문을 한 줄씩 "인도 / …" · "회중 / …" · "(다같이)…" 블록으로 바꾼다.
  // 라벨과 "/"를 너비가 고정된 칸에 넣고 본문을 flex로 흘려서, 본문이 길어져
  // 다음 줄로 내려가도 "인도"/"회중" 글자 밑이 아니라 본문 시작 위치에
  // 맞춰 정렬되게 한다(hanging indent).
  function gyodokmunBlocks(text) {
    const lines = (text || "").split("\n").map(t => t.trim()).filter(Boolean);
    return lines.map(line => {
      const m = line.match(/^(인도|회중)\s*\/\s*(.*)$/);
      if (m) {
        return `<div class="gyodokmun-line"><span class="gyodokmun-role">${escapeText(m[1])}</span><span class="gyodokmun-sep">/</span><span class="gyodokmun-text">${escapeText(m[2])}</span></div>`;
      }
      return `<div class="gyodokmun-line gyodokmun-unison"><span class="gyodokmun-role"></span><span class="gyodokmun-sep"></span><span class="gyodokmun-text">${escapeText(line)}</span></div>`;
    });
  }

  // 성경 본문을 여러 블록으로 나눠서 반환한다. 본문이 길면 한 블록(하나의
  // scripture-block)이 한 페이지 높이보다 커져서 화면 아래로 잘려버릴 수 있으므로,
  // 페이지 나누기가 그 사이사이에서 끊을 수 있도록 여러 개의 작은 블록으로 쪼갠다.
  function scriptureBlocks(item) {
    if (!item.scriptureText) return [];
    let chunks = item.scriptureText
      .split(/\n\s*\n/)
      .map(t => t.trim())
      .filter(Boolean);

    // 빈 줄로 문단이 나뉘어 있지 않은(절을 한 줄씩 쭉 이어붙인) 긴 본문은
    // 몇 줄 단위로 자동으로 묶어서 나눈다.
    if (chunks.length <= 1) {
      const lines = (item.scriptureText || "").split("\n").map(t => t.trim()).filter(Boolean);
      if (lines.length > 3) {
        const groupSize = 3;
        chunks = [];
        for (let i = 0; i < lines.length; i += groupSize) {
          chunks.push(lines.slice(i, i + groupSize).join("\n"));
        }
      }
    }
    if (chunks.length === 0) chunks = [item.scriptureText.trim()];

    return chunks.map((chunk, i) => {
      const refHtml = (i === 0 && item.scriptureRef) ? `<span class="scripture-ref">${item.scriptureRef}</span>` : "";
      return `<div class="scripture-block">${refHtml}${textToBr(chunk)}</div>`;
    });
  }

  const sermonBodyRaw = `오늘 우리는 하나님께서 사랑하시는 故 송철헌 집사님을 기억하며, 가족이 함께 모여 하나님께 예배를 드리고 있습니다.

사실 아버님은 우리가 어린 시절에 돌아가셔서 많은 기억이 남아 있지 않습니다. 그럼에도 그때 그 시절 아버지와 함께했던 일들은 여전히 추억으로 남아 있고, 그 시절이 가끔은 그립기도 합니다.

그리고 자라면서는 아버지의 빈자리로 인해서 겪어야 했던 많은 일들로 인해서, 어떨 때는 아버지에 대한 아쉬움, 또는 약간의 원망, 사실 이런 것이 있었던 것도 사실입니다.

그런데 결혼을 해서 내가 아빠가 되어보니, 또 아버지가 돌아가셨던 그 나이를 지나다 보니, 다는 모르지만 그때의 아버지의 마음을 조금은 이해할 수 있겠다는 생각도 듭니다.

아무튼 오늘 돌아가신 아버지를 생각하면, 많은 감정이 교차하면서, 여전히 아쉽고 그리움으로 남아있지만, 오늘 주신 말씀은 그와 같은 우리에게 큰 위로와 소망이 될 줄 믿습니다.

오늘 본문말씀은 사도 바울이 자신의 인생의 마지막 순간에 고백한 말이지요. 그가 지나온 순간들을 돌아보면서, 그는 세 가지로 정리해서 이야기를 합니다.

첫째는 그가 "선한 싸움을 싸웠다"는 것입니다.
둘째는 그가 "달려갈 길을 다 마쳤다"는 것입니다.
셋째는 그가 "믿음을 끝까지 지켰다"는 것입니다.

그렇습니다. 우리는 이미 바울이 어떠한 삶을 살았는지 잘 알고 있습니다. 주님의 부르심을 입고, 6절에서 말하듯이 주님이 하라고 하신 이방인을 위한 사도로서의 사명을 위해서 완전히 전제로 부음바 될 정도로 자신을 온전히 드렸습니다.

그 일을 위해서 바울은 치열하게 선한 싸움을 싸웠고, 달려갈 길을 달려갔고, 끝까지 믿음을 지켰습니다.

저는 우리 아버님의 삶 또한 바울 사도와는 약간 결이 다를 수 있겠지만, 그와 같았다고 생각합니다. 한 평생 가장으로서 가정을 지키고, 자녀들을 양육하기 위해 수많은 땀방울을 흘리셨습니다. 때로는 세상의 고단함과 어려움 속에서도 묵묵히 자신의 자리를 지키며 선한 싸움을 다 싸웠다고 생각합니다.

비록 육신의 질고로 인해서 암투병을 하다 부르심을 받았지만, 감사하게도 투병 중에 예수님을 믿고 천국을 바라보면서, 마지막 하나님이 아버지에게 부여한 이 땅에서의 맡겨진 사명을 다하고, 인생의 달려갈 길을 성실하게 완주하셨다고 믿습니다.

그리고 사도 바울은 이렇게 달려갈 길을 마친 후, 자신을 위해 "의의 면류관이 예비되어 있다"고 고백합니다. 아버님도 이 세상에서의 모든 고단함을 내려놓고, 주님의 따뜻한 품에서 지금 그 영광스러운 면류관을 쓰고 계시다고 믿습니다.

사랑하는 우리 누님, 형님, 형수님, 우리 여보, 찬영이...

여러분, 한 번 죽는 것은 사람에게 정해진 것이기 때문에, 누구나 때가 되면 죽게 되는 것은 당연한 이치입니다. 누구도 이것을 피해갈 수도 없고, 이것을 거스를 사람은 아무도 없습니다.

그런데 중요한 것은 그 뒤의 말씀 아니겠습니까? 죽음 이후에 심판이 있겠다는 것입니다.

그러므로 이제 남겨진 우리들의 과제는, 아버님이 그러하셨듯, 우리 각자에게 주어진 삶의 자리에서 선한 싸움을 싸워가는 것입니다. 그리고 우리의 신앙을 끝까지 지켜가는 것입니다.

— 믿음이 없는 자는 다시 예수님을 믿는 믿음을 가져야 할 것이요.
— 믿음이 흔들리는 자는 흔들리지 않는 믿음을 다시 가져야 할 것이요.
— 믿음이 있는 자는 더욱 담대하고 더욱 강한 믿음을 가지기 위해서 신앙의 싸움을 싸워가야 할 것입니다.

뿐만 아니라 우리 자녀들의 신앙을 복되게 세워가게 하기 위해서, 끊임없이 말씀으로 양육하고 기도로 세워가야 할 줄 믿습니다.

그리고 중요한 것은 하나님께서 우리에게 주어진 사명을 다하는 것입니다. 하나님이 각자에게 주신 달란트가 있습니다. 다섯 개냐, 두 개냐, 한 개냐가 중요하지 않습니다. 끝까지 성실한 종 되어서 주님 앞에 설 때 남길 열매가 있어야 한다는 것입니다. 한 달란트 받은 자처럼 땅에 묻어두는 일은 없어야 하고, 하나님이 주신 사명을 위해서 끝까지 달려가야 할 줄 믿습니다.

그리고 우리 서로 더 사랑하고 화목하게 살아가는 우리 가족이 되어야 할 줄 믿습니다.

이렇게 될 때, 우리는 훗날 천국에서 아버님과 어머님을 다시 만나게 될 것입니다. 우리가 서로 다시 만날 때는 어떤 모습으로 만나게 될지는 아무도 모르지요. 그러나 다는 몰라도, 아마 영광스러운 모습일 것입니다.

그 날을 기대하며, 이 땅 가운데서 우리는 성실하게 살아가고, 그리고 믿음의 길을 이어가는 우리 복된 가정이 되기를 주님의 이름으로 축원합니다.

옆 사람과 인사합시다.
"선한 싸움을 싸웁시다."
"달려갈 길을 달려갑시다."
"믿음을 끝까지 지킵시다."`;

  const sermonPrayerRaw = `함께 기도합시다.

— 우리가 하는 사역을 위해서: 찬양선교 디딤을 위해서, 은혜가풍성한교회를 위해서

— 우리의 자녀들을 위해서: 신앙과 미래의 꿈, 배우자 — 송찬희(대학원), 송예희(복학), 송찬영(대학생활과 내년의 군입대), 송찬민(고3), 송예인(꿈)을 위해서

— 우리가 하는 기업을 위해서: 디딤카페, 어린이집, 누님의 미래의 삶을 하나님이 지켜달라고 기도합시다.

하나님 아버지, 오늘 아버님을 추모하며 드리는 예배를 통해 우리 마음에 천국 소망과 위로를 주시니 감사합니다. 아버님이 남겨주신 아름다운 유산을 기억하며, 남겨진 가족들이 서로 우애하고 하나님을 기쁘시게 하는 삶을 살게 하여 주옵소서. 예수님의 이름으로 기도드립니다. 아멘.`;

  const mukdoPrayerRaw = `하나님 아버지, 이 시간 故 송철헌 집사님의 추도예배로 가족들이 함께 모였습니다.

원하옵기는 우리가 하나님을 믿는 자들로서, 죽음으로 인한 슬픔이나 죽음에 대한 어떤 두려움을 가지고 예배하는 것이 아니고, 오직 죽음을 이기신 부활하신 예수님을 바라보고, 죽음 이후에 있을 영광스러움을 바라보면서 감사함으로, 예배하는 귀하고 복된 시간 되도록 인도하여 주시옵소서.

이 시간 성령님 함께 해 주시고, 악한 마귀 틈 못 타게 하시고, 오직 주님만 바라보는 은혜로운 시간 되게 하여주시옵소서.

예수님의 귀하신 이름으로 기도합니다. 아멘.`;

  const lordsPrayerRaw = `하늘에 계신 우리 아버지여, 이름이 거룩히 여김을 받으시오며,
나라이 임하옵시며, 뜻이 하늘에서 이룬 것같이 땅에서도 이루어지이다.
오늘날 우리에게 일용할 양식을 주옵시고,
우리가 우리에게 죄 지은 자를 사하여 준 것같이 우리 죄를 사하여 주옵시고,
우리를 시험에 들게 하지 마옵시고, 다만 악에서 구하옵소서.
대개 나라와 권세와 영광이 아버지께 영원히 있사옵나이다. 아멘.`;

  // 찬송 악보 이미지 — 설정 화면에서 항목마다 직접 사진을 올릴 수도 있고
  // (item.hymnImage에 data URL로 저장됨, 이게 있으면 항상 우선), 직접
  // 올리지 않았으면 "찬송가 폴더/번호.확장자" 규칙으로 자동 매칭을 시도한다.
  // 실제로 그 경로에 파일이 있는지 미리 로드해 보고, 되는 확장자를 찾으면
  // 그 경로를, 하나도 없으면 안내 문구를 돌려준다(페이지 계산 전에 미리
  // 확정해 두어야 나중에 이미지가 깨져서 화면이 잘리는 일이 없다).

  const HYMN_IMAGE_EXTS = ["jpg", "jpeg", "png", "webp"];
  const hymnImageResolveCache = {};
  const hymnImageDbCache = {};

  function cleanHymnNum(num) {
    return (num || "").toString().trim().replace(/\s*장\s*$/, "").trim();
  }

  // "자료 폴더 선택해서 연결하기"(또는 찬송가.html)로 저장해 둔 사진이 있으면
  // 그것을 먼저 쓰고, 없으면 기존의 "폴더 경로 + 번호.확장자" 상대주소 방식으로
  // 대체한다. 숫자 장 번호가 있으면 숫자 키로 먼저 찾고(찬송가.html과 동일한
  // 저장 방식), 없으면 제목 그대로를 문자열 키로 찾는다(CCM 등 번호 없는 곡).
  async function resolveHymnImageAny(clean) {
    if (clean in hymnImageDbCache) return hymnImageDbCache[clean];
    let src = null;
    try {
      const asNum = /^\d+$/.test(clean) ? parseInt(clean, 10) : null;
      const blob = asNum !== null ? await HymnImageDB.load(asNum) : await HymnImageDB.load(clean);
      if (blob) src = URL.createObjectURL(blob);
    } catch (e) {}
    if (!src) {
      const folder = (hymnFolder || defaultHymnFolder).replace(/\/?$/, "/");
      src = await resolveHymnImageSrc(folder, clean);
    }
    hymnImageDbCache[clean] = src;
    return src;
  }

  function tryLoadImage(src) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  async function resolveHymnImageSrc(folder, clean) {
    const key = folder + "|" + clean;
    if (key in hymnImageResolveCache) return hymnImageResolveCache[key];
    for (const ext of HYMN_IMAGE_EXTS) {
      const src = `${folder}${clean}.${ext}`;
      if (await tryLoadImage(src)) { hymnImageResolveCache[key] = src; return src; }
    }
    hymnImageResolveCache[key] = null;
    return null;
  }

  async function hymnSheetImageBlock(num, image) {
    if (image) {
      return `<img class="hymn-sheet-image" src="${image}" alt="찬송가 ${num || ""}장 악보">`;
    }
    const clean = cleanHymnNum(num);
    if (clean) {
      const src = await resolveHymnImageAny(clean);
      if (src) return `<img class="hymn-sheet-image" src="${src}" alt="찬송가 ${num || ""}장 악보">`;
      return `<div class="hymn-sheet-placeholder">"${num}" 악보 사진을 찾지 못했습니다.<br>설정에서 이 찬송 항목에 악보 사진을 올려주세요.</div>`;
    }
    return "";
  }

  async function hymnSheetBlock(item) {
    const primary = await hymnSheetImageBlock(item.hymnNum, item.hymnImage);
    const secondary = (item.hymnNum2 || item.hymnImage2)
      ? await hymnSheetImageBlock(item.hymnNum2, item.hymnImage2)
      : "";
    const blocks = [primary, secondary].filter(Boolean);
    if (!blocks.length) {
      return `<div class="hymn-sheet-placeholder">악보 사진이 아직 없습니다.<br>설정에서 이 찬송 항목에 악보 사진을 올려주세요.</div>`;
    }
    return blocks.join("");
  }

  let idCounter = 0;
  function newId() { idCounter += 1; return "item-" + Date.now() + "-" + idCounter; }


  function defaultItems() {
    return [
      {"id": "item-1788394409221-34", "num": "1", "sub": false, "title": "경배와찬양", "desc": "다같이", "type": "일반", "content": ""},
      {"id": "item-1788394409221-35", "num": "2", "sub": false, "title": "묵도", "desc": "다 함께", "type": "성경말씀", "scriptureRef": "", "scriptureText": "", "scriptureFirst": true, "content": ""},
      {"id": "item-1788394409221-36", "num": "3", "sub": false, "title": "찬송", "desc": "", "type": "찬송", "hymnNum": "", "hymnCaption": ""},
      {"id": "item-1788394409221-37", "num": "4", "sub": false, "title": "사도신경", "desc": "다같이", "type": "고정문구", "fixedText": "전능하사 천지를 만드신 하나님 아버지를 내가 믿사오며,\n그 외아들 우리 주 예수 그리스도를 믿사오니,\n이는 성령으로 잉태하사 동정녀 마리아에게 나시고,\n본디오 빌라도에게 고난을 받으사 십자가에 못박혀 죽으시고,\n장사한지 사흘만에 죽은자 가운데서 다시 살아나시며,\n하늘에 오르사 전능하신 하나님 우편에 앉아계시다가,\n저리로서 산자와 죽은자를 심판하러 오시리라.\n성령을 믿사오며, 거룩한 공회와, 성도가 서로 교통하는 것과,\n죄를 사하여 주시는 것과, 몸이 다시 사는 것과,\n영원히 사는 것을 믿사옵나이다. 아멘.", "content": "다같이 사도신경으로 신앙을 고백하겠습니다."},
      {"id": "item-1788394409221-38", "num": "5", "sub": false, "title": "교독문", "desc": "", "type": "일반", "content": ""},
      {"id": "item-1788394409221-39", "num": "6", "sub": false, "title": "찬송", "desc": "", "type": "찬송", "hymnNum": "", "hymnCaption": ""},
      {"id": "item-1788394409221-40", "num": "7", "sub": false, "title": "통성기도", "desc": "다같이", "type": "일반", "content": ""},
      {"id": "item-1788394409221-41", "num": "8", "sub": false, "title": "대표기도", "desc": "", "type": "일반", "content": ""},
      {"id": "item-1788394409221-42", "num": "9", "sub": false, "title": "성경봉독", "desc": "", "type": "성경본문", "scriptureRef": "", "scriptureText": ""},
      {"id": "item-1788394409221-43", "sub": true, "title": "설교", "desc": "", "type": "설교", "sermonContent": "", "content": ""},
      {"id": "item-1788394409221-44", "num": "10", "sub": false, "title": "헌금", "desc": "", "type": "일반", "content": ""},
      {"id": "item-1788394409221-45", "num": "11", "sub": false, "title": "헌금송", "desc": "", "type": "찬송", "hymnNum": "", "hymnCaption": ""},
      {"id": "item-1788394409221-46", "num": "12", "sub": false, "title": "폐회송", "desc": "", "type": "찬송", "hymnNum": "", "hymnCaption": ""},
      {"id": "item-1788394409221-47", "num": "13", "sub": false, "title": "축도", "desc": "담임목사", "type": "일반", "content": ""}
    ];
  }

  // ── 상태 불러오기 ─────────────────────────────
  //
  // 우선순위: ① 이 파일 안에 담겨 있는 데이터(embeddedData, "저장하기"로
  // 만든 파일에는 내용이 들어 있다 — 컴퓨터를 옮겨도 파일만 있으면 그대로 보인다)
  // → ② 이 브라우저의 로컬 저장(localStorage, "저장하기"를 누를 때 함께
  // 저장된다) → ③ 기본 예배 순서

  let serviceTitle = defaultServiceTitle;
  const defaultHymnFolder = "찬송가/";
  let hymnFolder = defaultHymnFolder;
  let items = defaultItems();

  // 예전 설정 화면에서 저장된 데이터(구조가 지금과 다름)를 지금 구조로
  // 자동으로 맞춰준다 — localStorage나 파일에 이미 저장해 둔 내용이 있어도
  // 코드가 업데이트되면 그 자리에서 새 구조로 바뀐다.
  function migrateItem(item) {
    const it = Object.assign({}, item);

    // 예전 "성경봉독"(성경말씀 유형)을 지금의 "성경본문" 유형으로.
    if (it.type === "성경말씀" && it.title === "성경봉독") {
      it.type = "성경본문";
      delete it.content;
      delete it.scriptureFirst;
    }

    // 사도신경·주기도문처럼 실제 성경 본문이 아니라 항상 같은 고정된 글을
    // 읽는 항목은, 예전에는 편의상 "성경말씀" 유형(scriptureText 칸)에
    // 넣어뒀었다. 이제는 "고정문구" 유형으로 옮기고, 그 글은
    // fixedText 칸으로 이동한다 — 한번 입력되면 계속 그대로 쓰인다.
    if (it.type === "성경말씀" && (it.title === "사도신경" || it.title === "주기도문")) {
      it.type = "고정문구";
      it.fixedText = it.scriptureText || "";
      delete it.scriptureRef;
      delete it.scriptureText;
      delete it.scriptureFirst;
    }

    // 예전 설교 항목의 설교 제목 / 마무리 기도문을 본문 내용 하나로 합친다.
    if (it.type === "설교" && (it.sermonTitle || it.prayerContent)) {
      const parts = [];
      if (it.sermonTitle && it.sermonTitle.trim()) parts.push(it.sermonTitle.trim());
      if (it.content && it.content.trim()) parts.push(it.content.trim());
      if (it.prayerContent && it.prayerContent.trim()) parts.push(it.prayerContent.trim());
      it.content = parts.join("\n\n");
      delete it.sermonTitle;
      delete it.prayerContent;
    }

    // 설교 항목은 성경주소/본문 칸을 더 이상 쓰지 않는다(성경봉독 항목에 이미
    // 있으므로). 예전에 여기 써둔 본문이 있으면 버리지 않고 "설교내용" 칸으로
    // 옮겨준다.
    if (it.type === "설교") {
      if (it.sermonContent === undefined || it.sermonContent === null) {
        it.sermonContent = (it.scriptureText && it.scriptureText.trim()) ? it.scriptureText : "";
      }
      delete it.scriptureRef;
      delete it.scriptureText;
    }

    // 교독문 항목: 예전에는 멘트입력칸(content)에 "인도 / …" · "회중 / …"
    // 본문 전체를 그대로 담아 썼다. 이제 멘트입력칸은 사회자가 말할 한 줄
    // 짧은 도입 문구로 남겨두고, 교독문 본문은 별도 칸(gyodokmunText)으로
    // 옮긴다 — 이미 그 칸에 값이 있으면 건드리지 않는다.
    if (isGyodokmunItem(it) && !it.gyodokmunText &&
        /(^|\n)\s*(인도|회중)\s*\//.test(it.content || "")) {
      it.gyodokmunText = it.content;
      it.content = "";
    }

    // 통성기도·광고 항목: 예전에는 멘트입력칸(content)에 기도제목/안내 내용
    // 전체를 그대로 담아 썼다. 이제 멘트입력칸은 한 줄 짧은 도입 문구로
    // 남겨두고, 실제 내용은 별도 칸(longContent)으로 옮긴다 — 여러 줄로
    // 된(줄바꿈이 있는) 예전 내용만 옮기고, 이미 longContent 값이 있으면
    // 건드리지 않는다.
    if (isLongContentItem(it) && !it.longContent && (it.content || "").indexOf("\n") !== -1) {
      it.longContent = it.content;
      it.content = "";
    }

    return it;
  }

  function loadEmbeddedData() {
    try {
      const el = document.getElementById("embeddedData");
      if (!el) return null;
      const text = (el.textContent || "").trim();
      if (!text || text === "{}") return null;
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.items) && parsed.items.length) return parsed;
    } catch (e) {
      // 파일 안의 데이터가 손상되었으면 무시하고 다음 단계로 넘어간다.
    }
    return null;
  }

  function loadState() {
    const embedded = loadEmbeddedData();
    if (embedded) {
      serviceTitle = embedded.serviceTitle || defaultServiceTitle;
      hymnFolder = embedded.hymnFolder || defaultHymnFolder;
      items = embedded.items.map(migrateItem);
      return;
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && Array.isArray(saved.items) && saved.items.length) {
        serviceTitle = saved.serviceTitle || defaultServiceTitle;
        hymnFolder = saved.hymnFolder || defaultHymnFolder;
        items = saved.items.map(migrateItem);
      }
    } catch (e) {
      // 저장된 값을 읽지 못하면 기본값을 그대로 사용한다.
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ serviceTitle, hymnFolder, items }));
    } catch (e) {
      // 저장이 불가능한 환경(예: 일부 브라우저의 file:// 제한)이면 조용히 건너뛴다.
    }
  }

  loadState();

  // ── 항목 → 상세 화면 블록 변환 ─────────────────

  async function buildBlocks(item) {
    const label = item.title || "";
    const scriptureBlockList = scriptureBlocks(item);
    const contentBlocks = paragraphs(item.content);

    if (item.type === "찬송") {
      const sheet = await hymnSheetBlock(item);
      // 멘트입력칸에 직접 써둔 멘트가 있으면 그걸 쓰고, 없으면 기본 문구를 자동으로 만든다.
      const hymnNums = [item.hymnNum, item.hymnNum2].filter(n => n && n.trim());
      const caption = (item.content && item.content.trim())
        ? item.content.trim()
        : (hymnNums.length ? "다 함께 찬송가 " + hymnNums.map(n => n + "장").join(", ") + "을 부르겠습니다" : "");
      // 몇 장인지는 멘트 문구와 악보 자체에 이미 나와 있으므로, 화면 공간만
      // 차지하는 별도의 큰 숫자 표시는 넣지 않는다.
      return [
        `<div class="section-label">${label}</div>`,
        caption ? `<div class="hymn-caption">${caption}</div>` : "",
        sheet
      ].filter(Boolean);
    }

    if (item.type === "설교") {
      // 성경주소·본문은 이미 "성경봉독" 항목에서 보여주므로 여기서는 쓰지 않는다.
      // 멘트입력칸(간단한 도입 멘트)은 본문과 헷갈리지 않게 작고 옅은 글씨로,
      // 그 다음 설교내용(원고 전체)은 원래 크기로 이어서 보여준다.
      const introBlocks = paragraphs(item.content, "content-caption");
      const sermonBlocks = sermonTextBlocks(item.sermonContent);
      return [
        `<div class="section-label">${label}</div>`,
        ...introBlocks,
        ...sermonBlocks
      ].filter(Boolean);
    }

    if (item.type === "성경본문") {
      // 멘트입력칸에 써둔 멘트가 있으면 성경 본문 앞에 먼저 보여준다.
      return [...contentBlocks, ...scriptureBlockList].filter(Boolean);
    }

    if (item.type === "성경말씀") {
      const ordered = item.scriptureFirst
        ? [...scriptureBlockList, ...contentBlocks]
        : [...contentBlocks, ...scriptureBlockList];
      return [`<div class="section-label">${label}</div>`, ...ordered].filter(Boolean);
    }

    if (item.type === "고정문구") {
      // 성경 본문이 아니라 항상 같은 글(사도신경·주기도문 등)을 그대로 보여준다.
      // 멘트("다같이 사도신경으로...")는 본문과 헷갈리지 않게 작고 옅은 글씨로 구분한다.
      const introBlocks = paragraphs(item.content, "content-caption");
      const fixedBlocks = paragraphs(item.fixedText);
      return [`<div class="section-label">${label}</div>`, ...introBlocks, ...fixedBlocks].filter(Boolean);
    }

    if (isGyodokmunItem(item)) {
      // 멘트입력칸(한 줄 도입 멘트)은 작고 옅은 글씨로, 그 아래 교독문 본문
      // (인도/회중)은 별도 칸(gyodokmunText)에서 가져와 줄마다 정렬해 보여준다.
      const introBlocks = paragraphs(item.content, "content-caption");
      const readingBlocks = gyodokmunBlocks(item.gyodokmunText);
      return [`<div class="section-label">${label}</div>`, ...introBlocks, ...readingBlocks].filter(Boolean);
    }

    if (isLongContentItem(item)) {
      // 통성기도·광고: 멘트입력칸(한 줄 도입 멘트)은 작고 옅은 글씨로, 그 아래
      // 실제 내용(기도제목/안내 내용 전체)은 별도 칸(longContent)에서 가져와 보여준다.
      const introBlocks = paragraphs(item.content, "content-caption");
      const bodyBlocks = paragraphs(item.longContent);
      return [`<div class="section-label">${label}</div>`, ...introBlocks, ...bodyBlocks].filter(Boolean);
    }

    // 일반
    return [`<div class="section-label">${label}</div>`, ...contentBlocks].filter(Boolean);
  }

  // ── 목록 렌더링 ─────────────────────────────

  const serviceTitleDisplay = document.getElementById("serviceTitleDisplay");
  const listEl = document.getElementById("orderList");

  // 지금까지 열어본 항목 중 가장 마지막 항목의 id. 목록으로 돌아왔을 때도
  // 이 항목을 계속 강조해서, 예배를 인도하다가 지금 어디까지 왔는지
  // 놓치지 않도록 한다.
  let currentOrderItemId = null;

  function markCurrentOrderItem() {
    listEl.querySelectorAll(".order-item").forEach(btn => {
      btn.classList.toggle("current", btn.dataset.id === currentOrderItemId);
    });
  }

  function renderList() {
    serviceTitleDisplay.textContent = serviceTitle;
    document.title = serviceTitle + " — 예배 순서지";

    listEl.innerHTML = "";
    items.filter(item => !item.hidden).forEach(item => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.className = "order-item" + (item.sub ? " sub" : "");
      btn.dataset.id = item.id;
      btn.innerHTML = `
        <div class="order-num">${item.sub ? "•" : (item.num || "")}</div>
        <div class="order-body">
          <div class="order-title">${item.title || ""}</div>
          <div class="order-desc">${item.desc || ""}</div>
        </div>
        <div class="order-arrow">›</div>
      `;
      btn.addEventListener("click", () => openDetail(item));
      li.appendChild(btn);
      listEl.appendChild(li);
    });
    markCurrentOrderItem();
  }

  renderList();

  // ── 페이지 넘김 엔진 ─────────────────────────
  //
  // 각 항목의 블록(문단/성경구절 등 HTML 조각)을, 실제 화면 높이에 맞춰
  // "한 화면에 들어가는 만큼씩" 그리디하게 묶어 페이지로 나눈다.
  // 글자 크기를 바꾸거나 화면 방향이 바뀌면 다시 계산한다.

  const overlay = document.getElementById("detailOverlay");
  const detailHeaderTitle = document.getElementById("detailHeaderTitle");
  const pagerViewport = document.getElementById("pagerViewport");
  const pagerInner = document.getElementById("pagerInner");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageIndicator = document.getElementById("pageIndicator");
  const tapLeft = document.getElementById("tapLeft");
  const tapRight = document.getElementById("tapRight");

  let currentItem = null;
  let currentPages = [[]];
  let currentPageIndex = 0;

  // 측정용 요소 안에 들어있는 이미지가 실제로 로드될 때까지 기다린다.
  // 이미지는 로드되기 전까지 높이를 알 수 없어서, 기다리지 않고 재면
  // 사진이 없는 것처럼(높이 0) 잘못 측정되어 다음 페이지로 안 넘어가고
  // 화면 아래로 잘려버린다.
  function waitForImages(container) {
    const imgs = container.querySelectorAll("img");
    return Promise.all(Array.from(imgs).map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        img.addEventListener("load", resolve, { once: true });
        img.addEventListener("error", resolve, { once: true });
      });
    }));
  }

  async function paginateBlocks(blockHtmls) {
    if (blockHtmls.length === 0) return [[]];

    const measurer = document.createElement("div");
    measurer.className = "pager-viewport-inner";
    measurer.style.position = "absolute";
    measurer.style.visibility = "hidden";
    measurer.style.pointerEvents = "none";
    measurer.style.width = pagerInner.clientWidth + "px";
    document.body.appendChild(measurer);

    const maxHeight = pagerViewport.clientHeight - 40; // 상하 padding 20px씩

    // 블록 0번부터 i번까지를 이어붙였을 때의 누적 높이를 미리 재둔다.
    // 이렇게 해두면 이후에는 DOM을 다시 재지 않고 뺄셈만으로 어느 구간이든
    // 높이를 바로 알 수 있다.
    const cumulativeHeights = [];
    for (let i = 0; i < blockHtmls.length; i++) {
      measurer.innerHTML = blockHtmls.slice(0, i + 1).join("");
      await waitForImages(measurer); // 이미지 높이가 반영된 뒤에 측정한다
      cumulativeHeights.push(measurer.scrollHeight);
    }
    document.body.removeChild(measurer);

    function heightOf(start, endExclusive) {
      const upTo = cumulativeHeights[endExclusive - 1];
      return start === 0 ? upTo : upTo - cumulativeHeights[start - 1];
    }

    // 주어진 한도(cap) 안에서 최대한 채워 담는 그리디 분배.
    function packWithCap(cap) {
      const pages = [];
      let start = 0;
      for (let i = 0; i < blockHtmls.length; i++) {
        if (i > start && heightOf(start, i + 1) > cap) {
          pages.push(blockHtmls.slice(start, i));
          start = i;
        }
      }
      pages.push(blockHtmls.slice(start));
      return pages;
    }

    // 화면 높이(maxHeight)를 한도로 그냥 채우면, 앞쪽 페이지들은 꽉 차고
    // 마지막 페이지만 얼마 안 남아 휑하게 보이는 등 페이지마다 분량이
    // 들쑥날쑥해진다. 필요한 페이지 수(targetCount)는 그대로 유지하면서,
    // 그 페이지 수를 만들어내는 가장 작은 한도를 이진 탐색으로 찾아 다시
    // 나누면 각 페이지 분량이 훨씬 고르게 맞춰진다.
    const targetCount = packWithCap(maxHeight).length;
    let lo = 1;
    let hi = maxHeight;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (packWithCap(mid).length <= targetCount) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }

    const pages = packWithCap(hi);
    if (pages.length === 0) pages.push([]);
    return pages;
  }

  // 설교만 지금처럼 "페이지 넘김"을 유지한다. 그 외에는 전부 스크롤 방식.
  function isPagedType(item) {
    return !!item && item.type === "설교";
  }

  function openDetail(item) {
    currentItem = item;
    currentOrderItemId = item.id;
    markCurrentOrderItem();
    detailHeaderTitle.textContent = item.title;
    overlay.classList.toggle("scroll-mode", !isPagedType(item));
    overlay.classList.add("open");
    // overlay가 display:flex로 바뀐 다음 프레임에 실제 크기를 재야 정확하다.
    requestAnimationFrame(recomputePages);
  }

  async function recomputePages() {
    if (!currentItem) return;
    const item = currentItem;
    const blocks = await buildBlocks(item);
    if (currentItem !== item) return; // 그사이 다른 항목을 열었으면 버린다

    if (!isPagedType(item)) {
      // 스크롤 모드: 페이지로 나누지 않고 전체를 그대로 넣어서 세로로 쭉 보게 한다.
      currentPages = [blocks];
      currentPageIndex = 0;
      pagerInner.innerHTML = blocks.join("");
      pagerViewport.scrollTop = 0;
      pageIndicator.textContent = "";
      return;
    }

    const pages = await paginateBlocks(blocks);
    if (currentItem !== item) return; // 그사이 다른 항목을 열었으면 버린다
    currentPages = pages;
    currentPageIndex = 0;
    renderPage();
  }

  function renderPage() {
    pagerInner.innerHTML = currentPages[currentPageIndex]?.join("") ?? "";
    const total = currentPages.length;
    pageIndicator.textContent = total > 1 ? `${currentPageIndex + 1} / ${total}` : "";
    prevBtn.disabled = currentPageIndex === 0;
    nextBtn.disabled = currentPageIndex === total - 1;
  }

  function goNext() {
    if (currentPageIndex < currentPages.length - 1) {
      currentPageIndex++;
      renderPage();
    }
  }

  function goPrev() {
    if (currentPageIndex > 0) {
      currentPageIndex--;
      renderPage();
    }
  }

  prevBtn.addEventListener("click", goPrev);
  nextBtn.addEventListener("click", goNext);
  tapLeft.addEventListener("click", goPrev);
  tapRight.addEventListener("click", goNext);

  function closeDetail() {
    overlay.classList.remove("open");
    currentItem = null;
  }

  document.getElementById("detailClose").addEventListener("click", closeDetail);

  // 상단 제목 표시줄(닫기 X 말고 아무 데나)을 눌러도 닫히게.
  document.getElementById("detailHeaderTitle").addEventListener("click", closeDetail);

  // 내용 화면 한가운데(좌우 30%씩은 페이지 넘기기 영역이라 제외)를
  // 눌러도 목록으로 바로 돌아가게 한다. 페이지 넘기기와 겹치지 않는다.
  pagerViewport.addEventListener("click", closeDetail);

  // 스와이프(좌우로 손가락 밀기)
  let touchStartX = null, touchStartY = null;
  pagerViewport.addEventListener("touchstart", e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  pagerViewport.addEventListener("touchend", e => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goNext(); else goPrev();
    }
    touchStartX = null; touchStartY = null;
  }, { passive: true });

  // 키보드(화살표)도 지원 — 데스크탑에서 미리보기/연습할 때 편하게
  document.addEventListener("keydown", e => {
    if (!overlay.classList.contains("open")) return;
    if (e.key === "ArrowRight") goNext();
    if (e.key === "ArrowLeft") goPrev();
    if (e.key === "Escape") { overlay.classList.remove("open"); currentItem = null; }
  });

  // 글자 크기 변경 — 열려 있는 항목이 있으면 페이지를 다시 계산한다
  // (페이지당 들어가는 분량이 바뀌므로 1페이지로 리셋).
  document.querySelectorAll(".text-size-control button").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".text-size-control button").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.documentElement.style.setProperty("--scale", btn.dataset.scale);
      if (overlay.classList.contains("open")) requestAnimationFrame(recomputePages);
    });
  });

  // 화면 방향 전환 등 — 열려 있을 때만, 살짝 지연 후 재계산
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (!overlay.classList.contains("open")) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(recomputePages, 200);
  });

  // ══════════════════════════════════════════════
  // 설정 화면 — 예배 이름 · 순서 배정 · 내용/데이터 입력
  // ══════════════════════════════════════════════

  const settingsOverlay = document.getElementById("settingsOverlay");
  const settingsOpenBtn = document.getElementById("settingsOpenBtn");
  const settingsCloseBtn = document.getElementById("settingsCloseBtn");
  const serviceTitleInput = document.getElementById("serviceTitleInput");
  const itemsEditor = document.getElementById("itemsEditor");
  const addItemBtn = document.getElementById("addItemBtn");
  const presetButtons = document.getElementById("presetButtons");
  const settingsResetBtn = document.getElementById("settingsResetBtn");
  const settingsSaveBtn = document.getElementById("settingsSaveBtn");
  const settingsExportBtn = document.getElementById("settingsExportBtn");
  const settingsJsonSaveBtn = document.getElementById("settingsJsonSaveBtn");
  const settingsJsonLoadBtn = document.getElementById("settingsJsonLoadBtn");
  const jsonLoadInput = document.getElementById("jsonLoadInput");

  const bibleVerIdInput = document.getElementById("bibleVerIdInput");
  const bibleStatusText = document.getElementById("bibleStatusText");
  const bibleImportFile = document.getElementById("bibleImportFile");
  const bibleImportBtn = document.getElementById("bibleImportBtn");
  const bibleCheckBtn = document.getElementById("bibleCheckBtn");
  const hymnFolderInput = document.getElementById("hymnFolderInput");
  const dataFolderPickBtn = document.getElementById("dataFolderPickBtn");
  const dataFolderInput = document.getElementById("dataFolderInput");
  const dataFilesPickBtn = document.getElementById("dataFilesPickBtn");
  const dataFilesInput = document.getElementById("dataFilesInput");
  const dataFolderStatusText = document.getElementById("dataFolderStatusText");
  const dataSettingsToggleBtn = document.getElementById("dataSettingsToggleBtn");
  const dataSettingsAdvanced = document.getElementById("dataSettingsAdvanced");

  dataSettingsToggleBtn.addEventListener("click", () => {
    const open = dataSettingsAdvanced.style.display !== "none";
    dataSettingsAdvanced.style.display = open ? "none" : "block";
    dataSettingsToggleBtn.textContent = open ? "자료 연결 설정 열어보기 ▾" : "자료 연결 설정 닫기 ▴";
  });

  const VALID_ITEM_TYPES = ["일반", "성경말씀", "성경본문", "찬송", "설교"];

  async function refreshBibleStatus() {
    const verId = bibleVerIdInput.value.trim();
    if (!verId) { bibleStatusText.textContent = "번역본 이름(ID)을 입력해주세요."; return; }
    try {
      const db = await loadBibleDB(verId);
      if (db) {
        let count = 0;
        try {
          const res = db.exec('SELECT COUNT(*) FROM Bible');
          count = (res[0] && res[0].values && res[0].values[0] && res[0].values[0][0]) || 0;
        } catch (e) {}
        bibleStatusText.textContent = `연결됨: "${verId}"` + (count ? ` (${count}구절)` : "");
        setActiveBibleVerId(verId);
      } else {
        bibleStatusText.textContent = "이 이름으로 저장된 성경 데이터가 없습니다. 정확한 이름인지 확인하시거나, 아래에서 .mybible 파일을 올려 새로 저장해주세요.";
      }
    } catch (e) {
      bibleStatusText.textContent = "확인 중 오류가 발생했습니다: " + e.message;
    }
  }

  bibleCheckBtn.addEventListener("click", refreshBibleStatus);

  bibleImportBtn.addEventListener("click", async () => {
    const file = bibleImportFile.files && bibleImportFile.files[0];
    if (!file) { alert(".mybible 파일을 선택해주세요."); return; }
    try {
      const buf = await file.arrayBuffer();
      const name = stripMyswordExt(file.name);
      await AppDB.save('bible:' + name, buf, { fileName: file.name });
      delete BIBLE_DBS[name];
      Object.keys(BIBLE_CHAPTER_CACHE).forEach(k => { if (k.indexOf(name + '_') === 0) delete BIBLE_CHAPTER_CACHE[k]; });
      setActiveBibleVerId(name);
      bibleVerIdInput.value = name;
      bibleStatusText.textContent = `저장 완료: "${name}"`;
    } catch (e) {
      alert("가져오기에 실패했습니다: " + e.message);
    }
  });

  // ══════════════════════════════════════════════
  // "자료 폴더 선택해서 연결하기" — 성경(.mybible)과 찬송가 사진이 함께 든
  // 폴더를 한 번에 골라서, 성경은 AppDB에, 사진은 HymnImageDB에 나눠 저장한다.
  // 폴더 선택을 지원하지 않는 기기(예: 일부 아이패드)에서는 input의
  // webkitdirectory가 무시되고 일반 다중 파일 선택으로 동작한다.
  function fileBaseName(name) {
    return (name || "").replace(/\.[^.\/]+$/, "");
  }

  async function refreshDataFolderStatus() {
    try {
      const n = await HymnImageDB.count();
      const verId = getActiveBibleVerId();
      if (n > 0 || verId) {
        dataFolderStatusText.textContent =
          `연결됨 — 악보 이미지 ${n}개 저장됨` + (verId ? `, 성경 "${verId}" 연결됨.` : ".");
      }
    } catch (e) {}
  }

  dataFolderPickBtn.addEventListener("click", () => dataFolderInput.click());
  dataFilesPickBtn.addEventListener("click", () => dataFilesInput.click());

  async function importDataFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    dataFolderStatusText.textContent = "가져오는 중… (사진이 많으면 시간이 걸릴 수 있습니다)";
    dataFolderPickBtn.disabled = true;
    dataFilesPickBtn.disabled = true;

    let bibleName = "";
    let imageCount = 0, imageFail = 0;

    for (const file of files) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".mybible")) {
        try {
          const buf = await file.arrayBuffer();
          const name = stripMyswordExt(file.name);
          await AppDB.save('bible:' + name, buf, { fileName: file.name });
          delete BIBLE_DBS[name];
          Object.keys(BIBLE_CHAPTER_CACHE).forEach(k => { if (k.indexOf(name + '_') === 0) delete BIBLE_CHAPTER_CACHE[k]; });
          setActiveBibleVerId(name);
          bibleName = name;
        } catch (e) { /* 성경 파일이 아니면 조용히 건너뛴다 */ }
        continue;
      }
      const ext = lower.split(".").pop();
      if (HYMN_IMAGE_EXTS.includes(ext)) {
        try {
          const num = parseHymnNumber(file.name);
          const key = num !== null ? num : cleanHymnNum(fileBaseName(file.name));
          if (key === "" || key === null) continue;
          await HymnImageDB.save(key, file);
          imageCount++;
        } catch (e) { imageFail++; }
      }
    }

    // 새로 저장된 이미지/성경이 곧바로 반영되도록 기존 결과 캐시를 비운다.
    Object.keys(hymnImageDbCache).forEach(k => delete hymnImageDbCache[k]);

    const parts = [];
    parts.push(bibleName ? `성경 "${bibleName}" 연결됨` : "성경 데이터(.mybible)를 찾지 못했습니다");
    parts.push(`악보 이미지 ${imageCount}개 저장됨` + (imageFail ? ` (${imageFail}개 실패)` : ""));
    dataFolderStatusText.textContent = parts.join(" · ");

    if (bibleName) {
      bibleVerIdInput.value = bibleName;
      refreshBibleStatus();
    }

    dataFolderPickBtn.disabled = false;
    dataFilesPickBtn.disabled = false;
  }

  dataFolderInput.addEventListener("change", async () => {
    await importDataFiles(dataFolderInput.files);
    dataFolderInput.value = "";
  });

  dataFilesInput.addEventListener("change", async () => {
    await importDataFiles(dataFilesInput.files);
    dataFilesInput.value = "";
  });

  // 자주 쓰는 순서 — 눌러서 예배순서 배정에 바로 추가한다.
  // 더 필요한 순서는 "+ 새 순서 추가"로 직접 만들면 된다.
  const PRESET_ITEMS = [
    { label: "경배와찬양", type: "일반", desc: "다같이" },
    { label: "묵도", type: "성경말씀", desc: "다 함께", scriptureFirst: true },
    { label: "찬송", type: "찬송", desc: "다같이" },
    { label: "교독문", type: "일반", desc: "" },
    { label: "대표기도", type: "일반", desc: "" },
    { label: "통성기도", type: "일반", desc: "다같이" },
    { label: "성경봉독", type: "성경본문", desc: "" },
    { label: "설교", type: "설교", desc: "" },
    { label: "특송", type: "일반", desc: "" },
    { label: "헌금", type: "일반", desc: "" },
    { label: "헌금송", type: "찬송", desc: "" },
    { label: "광고", type: "일반", desc: "" },
    { label: "주기도문", type: "고정문구", desc: "예배를 마치며", fixedText: lordsPrayerRaw },
    { label: "폐회송", type: "찬송", desc: "" },
    { label: "축도", type: "일반", desc: "" },
  ];

  // 편집 중에는 items를 직접 건드리지 않고 별도의 작업본(draft)에서 수정한 뒤
  // "저장" 버튼을 눌러야만 실제 목록에 반영한다.
  let draftItems = [];

  // 지금 펼쳐져 있는 항목의 id — 한 번에 하나만 펼쳐진다(네이버 블로그
  // 카테고리 관리처럼, 목록은 항상 한 줄씩만 보이고 누른 것만 펼쳐서 작업).
  let expandedItemId = null;

  function cloneItems(src) { return src.map(it => Object.assign({}, it)); }

  function openSettings() {
    draftItems = cloneItems(items);
    expandedItemId = null;
    serviceTitleInput.value = serviceTitle;
    renderItemsEditor();
    settingsOverlay.classList.add("open");
    bibleVerIdInput.value = getActiveBibleVerId();
    if (getActiveBibleVerId()) refreshBibleStatus();
    hymnFolderInput.value = hymnFolder;
    refreshDataFolderStatus();
  }

  function closeSettings() {
    settingsOverlay.classList.remove("open");
  }

  settingsOpenBtn.addEventListener("click", openSettings);
  settingsCloseBtn.addEventListener("click", closeSettings);

  function addPresetItem(preset) {
    const item = {
      id: newId(),
      num: String(draftItems.filter(it => !it.sub).length + 1),
      sub: false,
      hidden: false,
      title: preset.label,
      desc: preset.desc || "",
      type: preset.type,
      content: preset.content || "",
    };
    if (preset.type === "성경말씀" || preset.type === "성경본문") {
      item.scriptureRef = preset.scriptureRef || "";
      item.scriptureText = preset.scriptureText || "";
    }
    if (preset.type === "성경말씀") {
      item.scriptureFirst = preset.scriptureFirst !== undefined ? preset.scriptureFirst : true;
    }
    if (preset.type === "설교") {
      item.sermonContent = preset.sermonContent || "";
    }
    if (preset.type === "고정문구") {
      item.fixedText = preset.fixedText || "";
    }
    if (preset.type === "찬송") {
      item.hymnNum = preset.hymnNum || "";
      item.hymnCaption = preset.hymnCaption || "";
    }
    draftItems.push(item);
    expandedItemId = item.id;
    renderItemsEditor();
    itemsEditor.querySelector(".item-row.expanded")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderPresetButtons() {
    presetButtons.innerHTML = "";
    PRESET_ITEMS.forEach(preset => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset-btn";
      btn.textContent = preset.label;
      btn.addEventListener("click", () => addPresetItem(preset));
      presetButtons.appendChild(btn);
    });
  }

  renderPresetButtons();

  // ══════════════════════════════════════════════
  // 교독문 데이터 — 예배성구.json의 "교독문" 항목을 그대로 파일에 담아둔다
  // (네트워크 없이도, 처음 열자마자 바로 번호 검색이 되도록).
  const GYODOKMUN_LIST = (() => {
    try {
      const data = window.GYODOKMUN_DATA;
      return Array.isArray(data) ? data : [];
    } catch (e) { console.error("교독문 데이터 읽기 실패:", e); return []; }
  })();
  const GYODOKMUN_BY_NUM = {};
  GYODOKMUN_LIST.forEach(entry => { GYODOKMUN_BY_NUM[entry.number] = entry; });

  // 항목이 "교독문"인지 판단 — 유형은 "일반"이지만 제목에 "교독문"이 들어있는 경우.
  function isGyodokmunItem(item) {
    return !!item && item.type === "일반" && (item.title || "").indexOf("교독문") !== -1;
  }

  // 멘트입력칸(한 줄 도입 문구)과 별도로, 본문 전체를 담는 "내용" 칸을
  // 따로 두는 항목들 — 통성기도(기도제목 전체), 광고(안내 내용 전체).
  function isLongContentItem(item) {
    if (!item || item.type !== "일반") return false;
    const title = item.title || "";
    return title.indexOf("통성기도") !== -1 || title.indexOf("광고") !== -1;
  }

  // isLongContentItem 항목의 "내용" 칸 제목을 항목 제목에 맞춰 알맞게 정해준다.
  function longContentLabel(item) {
    const title = (item && item.title) || "";
    if (title.indexOf("통성기도") !== -1) return "통성기도 내용";
    if (title.indexOf("광고") !== -1) return "광고 내용";
    return "내용";
  }

  // isLongContentItem 항목에서 멘트입력칸(한 줄 도입 문구)의 예시 placeholder.
  function longContentCaptionPlaceholder(item) {
    const title = (item && item.title) || "";
    if (title.indexOf("통성기도") !== -1) return "예: 성도 여러분, 함께 통성으로 기도하겠습니다";
    if (title.indexOf("광고") !== -1) return "예: 몇 가지 광고 말씀 드리겠습니다";
    return "예: 이 시간 찬송가 50장을 다함께 부르겠습니다";
  }

  // textarea 높이를 내용에 맞춰 자동으로 늘려준다(줄이 늘어나면 아래로 자연스럽게 확장).
  // CSS min-height는 그대로 지켜지므로, 짧은 내용이면 min-height만큼만 보인다.
  function autoGrowTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = el.scrollHeight + "px";
  }

  // 입력한 문자에서 숫자만 뽑아 교독문 번호로 사용 (예: "33", "33번", "제33번" 모두 허용).
  function parseGyodokmunNum(raw) {
    const m = (raw || "").match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  // 교독문 한 편의 lines(색상별 원문)를 인도/회중 대사로 바꾼다.
  // - 첫 줄(빨강, "33. 시편 72편")은 번호/제목 줄이므로 본문에서는 빼고 desc로만 쓴다.
  // - black → "인도 / …", blue → "회중 / …"
  // - 마지막 빨강 줄("(다같이)…")은 원문 그대로 둔다(이미 "(다같이)"가 붙어있음).
  function buildGyodokmunContent(entry) {
    const lines = (entry.lines || []).slice(1);
    return lines.map(line => {
      if (line.color === "blue") return "회중 / " + line.text;
      if (line.color === "black") return "인도 / " + line.text;
      return line.text;
    }).join("\n");
  }

  // 번호로 찾아서 교독문 본문(gyodokmunText)과 표시용 설명(desc)을 채워준다.
  // 멘트입력칸(content)은 사회자가 실제로 말할 한 줄짜리 도입 멘트이므로
  // 건드리지 않고, 비어 있을 때만 기본 문구를 넣어준다.
  // fieldInput/wrap을 함께 주면 화면(바 옆 입력칸, 펼쳐진 교독문 내용 칸)도 바로 갱신한다.
  function applyGyodokmunMatch(idx, raw, fieldInput, wrap) {
    const num = parseGyodokmunNum(raw);
    const entry = num !== null ? GYODOKMUN_BY_NUM[num] : null;
    if (!entry) return false;
    const content = buildGyodokmunContent(entry);
    const desc = `교독문 ${entry.number}번, ${entry.title}`;
    draftItems[idx].gyodokmunText = content;
    draftItems[idx].desc = desc;
    if (!draftItems[idx].content || !draftItems[idx].content.trim()) {
      draftItems[idx].content = "다같이 교독문으로 하나님께 나아가겠습니다.";
    }
    if (fieldInput) fieldInput.value = desc;
    const contentEl = wrap && wrap.querySelector(".content-input");
    if (contentEl) contentEl.value = draftItems[idx].content;
    const gyodokmunEl = wrap && wrap.querySelector(".gyodokmun-text-input");
    if (gyodokmunEl) {
      gyodokmunEl.value = content;
      autoGrowTextarea(gyodokmunEl);
    }
    return true;
  }

  function fieldGroupsForType(item) {
    // 각 유형에서 어떤 field-group을 보여줄지
    const type = item.type;
    return {
      // 설교는 성경봉독 항목에 이미 성경주소/본문이 있으므로 여기서는 따로 두지 않는다.
      scripture: type === "성경말씀" || type === "성경본문",
      sermon: type === "설교",
      fixed: type === "고정문구",
      hymn: type === "찬송",
      gyodokmun: isGyodokmunItem(item),
      longContent: isLongContentItem(item),
      showTypeSelect: type !== "설교" && type !== "성경본문",
      showScriptureFirstToggle: type === "성경말씀",
    };
  }

  // 바 옆 공용 입력칸(한 줄) 설정 — 유형에 따라 이 칸이 무엇과 연결되는지
  // 정한다. 입력한 값은 항상 순서 목록에 작게 표시될 내용(desc)이 되고,
  // 동시에 유형에 맞는 실제 데이터(찬송 장 번호 / 성경 주소)로도 쓰인다.
  function rowFieldConfigForType(item) {
    const type = item.type;
    if (type === "찬송") {
      return { dataKey: "hymnNum", placeholder: "예: 35장", icon: "🎵", title: "장 번호로 악보 자동 매칭" };
    }
    if (type === "성경말씀" || type === "성경본문") {
      return { dataKey: "scriptureRef", placeholder: "예: 창 1:1~5", icon: "📖", title: "주소로 성경 본문 자동으로 찾기" };
    }
    if (type === "설교") {
      return { dataKey: "desc", placeholder: "예: 담임목사", icon: null, title: "" };
    }
    if (isGyodokmunItem(item)) {
      return { dataKey: "desc", placeholder: "예: 33 (교독문 번호)", icon: "📜", title: "번호로 교독문 자동 검색해서 교독문 내용 칸에 채우기" };
    }
    return { dataKey: "desc", placeholder: "예: 다같이 / 김OO 집사님", icon: null, title: "" };
  }

  function renderItemsEditor() {
    itemsEditor.innerHTML = "";
    draftItems.forEach((item, idx) => {
      itemsEditor.appendChild(buildItemRowGroup(item, idx));
    });
    // 펼쳐진 항목이 있으면, 실제로 화면에 붙은 뒤(레이아웃이 잡힌 뒤)에
    // 이미 들어있는 내용 길이에 맞춰 칸 높이를 맞춰준다(붙기 전에는 높이를
    // 잴 수 없어 0으로 계산되므로, 반드시 appendChild 이후에 해야 한다).
    itemsEditor.querySelectorAll(".content-input, .sermon-content-input, .fixed-text-input, .gyodokmun-text-input, .long-content-input")
      .forEach(autoGrowTextarea);
  }

  // 한 항목 = [한 줄 요약 행(+빠른입력)] + (펼쳐진 경우에만) [편집 칸]
  function buildItemRowGroup(item, idx) {
    const wrap = document.createElement("div");
    const isExpanded = expandedItemId === item.id;

    const row = document.createElement("div");
    row.className = "item-row" + (isExpanded ? " expanded" : "") + (item.hidden ? " hidden-row" : "");

    // 항목의 실제 유형(찬송/성경/일반)에 상관없이 항상 같은 구조로 한 줄에
    // 렌더링한다 — 입력칸의 값은 항상 item.desc(순서 목록 표시용)이면서,
    // 동시에 유형에 맞는 매칭용 데이터(hymnNum/scriptureRef)도 겸한다.
    const fieldCfg = rowFieldConfigForType(item);
    const fieldValue = fieldCfg.dataKey === "desc" ? item.desc : item[fieldCfg.dataKey];

    row.innerHTML = `
      <div class="item-row-top">
        <div class="item-row-main">
          <span class="item-row-num">${item.sub ? "•" : (item.num || "-")}</span>
          <span class="item-row-title">${escapeText(item.title) || "(제목 없음)"}</span>
          <span class="item-row-badge">${item.type}</span>
        </div>
        <div class="item-row-field">
          <input type="text" class="item-row-field-input" placeholder="${fieldCfg.placeholder}" value="${escapeAttr(fieldValue)}">
          ${fieldCfg.icon ? `<button type="button" class="item-row-field-btn" title="${fieldCfg.title}">${fieldCfg.icon}</button>` : ""}
        </div>
        <div class="item-row-actions">
          <label class="item-row-hide-toggle" title="체크하면 예배 순서 목록에서 숨겨집니다">
            <input type="checkbox" class="hide-checkbox" ${item.hidden ? "checked" : ""}>
            숨김
          </label>
          <button type="button" class="item-row-up" title="위로">▲</button>
          <button type="button" class="item-row-down" title="아래로">▼</button>
          <button type="button" class="item-row-delete danger" title="삭제">삭제</button>
        </div>
      </div>
    `;

    row.querySelector(".item-row-main").addEventListener("click", () => {
      expandedItemId = isExpanded ? null : item.id;
      renderItemsEditor();
    });

    row.querySelector(".hide-checkbox").addEventListener("click", e => e.stopPropagation());
    row.querySelector(".hide-checkbox").addEventListener("change", e => {
      draftItems[idx].hidden = e.target.checked;
      row.classList.toggle("hidden-row", e.target.checked);
    });

    row.querySelector(".item-row-up").addEventListener("click", e => {
      e.stopPropagation();
      if (idx === 0) return;
      [draftItems[idx - 1], draftItems[idx]] = [draftItems[idx], draftItems[idx - 1]];
      renderItemsEditor();
    });

    row.querySelector(".item-row-down").addEventListener("click", e => {
      e.stopPropagation();
      if (idx === draftItems.length - 1) return;
      [draftItems[idx + 1], draftItems[idx]] = [draftItems[idx], draftItems[idx + 1]];
      renderItemsEditor();
    });

    row.querySelector(".item-row-delete").addEventListener("click", e => {
      e.stopPropagation();
      if (!confirm(`"${draftItems[idx].title || "이 순서"}" 항목을 삭제할까요?`)) return;
      if (expandedItemId === draftItems[idx].id) expandedItemId = null;
      draftItems.splice(idx, 1);
      renderItemsEditor();
    });

    // ── 바 옆 공용 입력칸: 입력한 내용은 순서 목록에 작게 표시되고(desc),
    //    유형에 따라 동시에 찬송 매칭 / 성경 본문 찾기에도 쓰인다 ──
    const fieldInput = row.querySelector(".item-row-field-input");
    const fieldBtn = row.querySelector(".item-row-field-btn");
    const isGyodokmun = isGyodokmunItem(item);

    fieldInput.addEventListener("click", e => e.stopPropagation());
    fieldInput.addEventListener("input", e => {
      const val = e.target.value;
      draftItems[idx].desc = val; // 목록 표시용 텍스트는 항상 함께 갱신
      if (fieldCfg.dataKey !== "desc") draftItems[idx][fieldCfg.dataKey] = val;
      // 교독문은 번호만 입력해도(숫자를 다 치는 순간) 바로 아래 "교독문 내용" 칸에
      // 본문을 채워준다 — 바 자체 글자(입력 중인 숫자)는 그대로 두고 내용만 미리 갱신.
      if (isGyodokmun) applyGyodokmunMatch(idx, val, null, wrap);
    });
    fieldInput.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); applyRowFieldMatch(); }
    });
    if (isGyodokmun || fieldCfg.dataKey === "scriptureRef") {
      // 입력칸에서 포커스가 빠져나가면(다른 곳을 클릭/탭 이동) 확정 검색을 한 번 더
      // 해서, 바 표시도 "교독문 33번, 시편 72편"처럼 보기 좋게 정리해준다.
      // 성경구절도 같은 방식으로: 엔터나 📖 버튼을 따로 누르지 않아도
      // 입력 후 다른 칸으로 넘어가기만 하면 자동으로 본문을 찾아 채운다.
      fieldInput.addEventListener("blur", () => applyRowFieldMatch());
    }
    if (fieldBtn) {
      fieldBtn.addEventListener("click", e => { e.stopPropagation(); applyRowFieldMatch(); });
    }

    async function applyRowFieldMatch() {
      const raw = fieldInput.value.trim();
      if (!raw) return;

      if (isGyodokmun) {
        // 교독문: 로컬 데이터에서 즉시 찾으므로 버튼이 없어도(blur로도) 동작한다.
        const ok = applyGyodokmunMatch(idx, raw, fieldInput, wrap);
        if (fieldBtn) {
          const original = fieldBtn.textContent;
          fieldBtn.disabled = true;
          fieldBtn.textContent = ok ? "✓" : "⚠";
          setTimeout(() => { fieldBtn.textContent = original; fieldBtn.disabled = false; }, 1500);
        }
        return;
      }

      if (!fieldBtn) return;
      draftItems[idx].desc = raw;
      draftItems[idx][fieldCfg.dataKey] = raw;
      const original = fieldBtn.textContent;
      fieldBtn.disabled = true;
      fieldBtn.textContent = "…";
      let ok = false;
      if (fieldCfg.dataKey === "hymnNum") {
        const clean = cleanHymnNum(raw);
        ok = !!(clean && await resolveHymnImageAny(clean));
      } else if (fieldCfg.dataKey === "scriptureRef") {
        ok = await autofillScriptureText(idx, null, { force: true });
      }
      fieldBtn.textContent = ok ? "✓" : "⚠";
      fieldBtn.disabled = false;

      if (fieldCfg.dataKey === "scriptureRef") {
        if (ok) {
          // 매칭에 성공하면, 지금 펼쳐져 있는 상세 편집 칸(성경주소·성경 본문)에도
          // 새로 찾은 내용이 그대로 보이도록 다시 그린다 — 안 그러면 바 옆
          // 입력칸만 바뀌고 아래 상세 칸은 예전 내용 그대로 남아있게 된다.
          renderItemsEditor();
          return;
        }
        // 실패 이유를 바로 알 수 있게 안내한다(연결 안 됨 / 책 이름 인식 실패 / 절 범위 없음 등).
        alert(lastScriptureLookupError || "본문을 찾지 못했습니다. 성경주소 표기(예: 사도행전 2:11~17)가 올바른지 확인해주세요.");
      }

      setTimeout(() => { fieldBtn.textContent = original; }, 1500);
    }

    wrap.appendChild(row);
    if (isExpanded) {
      wrap.appendChild(buildItemDetailPanel(item, idx, row));
    }
    return wrap;
  }

  // 펼쳐진 항목의 실제 편집 칸 — 번호 + 내용/데이터 입력 (제목·설명·유형은 순서 버튼이 이미 정해준다)
  function buildItemDetailPanel(item, idx, rowEl) {
    const panel = document.createElement("div");
    panel.className = "item-detail";

    const groups = fieldGroupsForType(item);

    panel.innerHTML = `
      <div class="item-detail-hint">이 항목만 수정합니다. 다 끝나면 목록으로 접어두고 다음 항목을 눌러 이어서 편집하세요.</div>

      <div class="field-row">
        <div class="settings-field field-title">
          <label class="field-label-strong">제목</label>
          <input type="text" class="title-input" value="${escapeAttr(item.title)}" placeholder="예: 특별순서">
        </div>
        <div class="settings-field field-num">
          <label class="field-label-strong">번호</label>
          <input type="text" class="num-input" value="${escapeAttr(item.num)}" placeholder="번호" ${item.sub ? "disabled" : ""}>
        </div>
      </div>
      <label class="checkbox-field" style="margin:0 0 14px;">
        <input type="checkbox" class="sub-checkbox" ${item.sub ? "checked" : ""}>
        하위 항목(번호 없이 · 표시)
      </label>

      <div class="settings-field" style="margin:28px 0 32px;">
        <label class="field-label-strong">멘트입력칸 (사회자가 실제로 말할 문구)</label>
        <textarea class="content-input" placeholder="${groups.gyodokmun ? "예: 다같이 교독문으로 하나님께 나아가겠습니다" : longContentCaptionPlaceholder(item)}">${escapeText(item.content)}</textarea>
      </div>

      <div class="field-group long-content-field ${groups.longContent ? "" : "hidden"}">
        <div class="field-group-title">${longContentLabel(item)}</div>
        <div class="settings-field">
          <textarea class="long-content-input" placeholder="이곳에 ${longContentLabel(item)}을 입력하세요.">${escapeText(item.longContent)}</textarea>
        </div>
      </div>

      <div class="field-group gyodokmun-field ${groups.gyodokmun ? "" : "hidden"}">
        <div class="field-group-title">교독문 내용</div>
        <div class="settings-field">
          <label>번호로 자동 검색해서 채우거나, 직접 입력·수정할 수 있습니다</label>
          <textarea class="gyodokmun-text-input" placeholder="예: 인도 / 하나님이여 주의 판단력을 왕에게 주시고 주의 공의를 왕의 아들에게 주소서&#10;회중 / 그가 주의 백성을 공의로 재판하며 주의 가난한 자로 정의를 재판하리니">${escapeText(item.gyodokmunText)}</textarea>
        </div>
      </div>

      <div class="field-group scripture-field ${groups.scripture ? "" : "hidden"}">
        <div class="field-group-title">${item.type === "성경본문" ? "성경본문" : "성경 관련 데이터"}</div>
        <div class="settings-field">
          <label>성경주소</label>
          <input type="text" class="scripture-ref-input" value="${escapeAttr(item.scriptureRef)}" placeholder="예: 디모데후서 4:7~8">
        </div>
        <div class="settings-field">
          <label>성경 본문</label>
          <textarea class="scripture-text-input">${escapeText(item.scriptureText)}</textarea>
          <button type="button" class="scripture-autofill-btn preset-btn" style="margin-top:8px;">📖 연결된 성경에서 자동 채우기</button>
        </div>
        ${groups.showScriptureFirstToggle ? `
        <label class="checkbox-field">
          <input type="checkbox" class="scripture-first-checkbox" ${item.scriptureFirst ? "checked" : ""}>
          성경구절을 본문 내용보다 앞에 표시
        </label>
        ` : ""}
      </div>

      <div class="field-group sermon-field ${groups.sermon ? "" : "hidden"}">
        <div class="field-group-title">설교내용</div>
        <div class="settings-field">
          <textarea class="sermon-content-input sermon-content-textarea" placeholder="설교 본문(원고)을 이곳에 붙여넣으세요. 성경주소·본문은 이미 성경봉독 항목에 있으니 여기서는 따로 넣지 않아도 됩니다.">${escapeText(item.sermonContent)}</textarea>
        </div>
      </div>

      <div class="field-group fixed-field ${groups.fixed ? "" : "hidden"}">
        <div class="field-group-title fixed-field-title">${(item.title || "고정문구") + " 내용"}</div>
        <div class="settings-field">
          <textarea class="fixed-text-input" placeholder="한번 입력해두면 계속 그대로 사용됩니다.">${escapeText(item.fixedText)}</textarea>
        </div>
      </div>

      <div class="field-group hymn-field ${groups.hymn ? "" : "hidden"}">
        <div class="field-group-title">찬송 관련 데이터</div>
        <div class="settings-field">
          <label>찬송가 장 번호 (또는 CCM 제목)</label>
          <input type="text" class="hymn-num-input" value="${escapeAttr(item.hymnNum)}" placeholder="예: 488">
        </div>
        <div class="settings-field">
          <label>찬송가 악보 사진 (직접 올리기 — 없으면 악보 폴더에서 자동으로 찾습니다)</label>
          <input type="file" accept="image/*" class="hymn-image-input">
          ${item.hymnImage ? `<img class="hymn-image-preview" src="${item.hymnImage}" alt="악보 미리보기">` : ""}
          ${item.hymnImage ? `<button type="button" class="hymn-image-remove-btn settings-reset-btn" style="padding:8px 0;">사진 삭제</button>` : ""}
          ${!item.hymnImage ? `<button type="button" class="hymn-auto-preview-btn preset-btn" style="margin-top:8px;">🔍 악보 폴더에서 자동매칭 미리보기</button><div class="hymn-auto-preview-result"></div>` : ""}
        </div>
        <div class="field-group-title" style="margin-top:16px;">찬송 2곡째 (함께 부를 때만 입력, 선택사항)</div>
        <div class="settings-field">
          <label>찬송가 장 번호 2 (또는 CCM 제목)</label>
          <input type="text" class="hymn-num-input-2" value="${escapeAttr(item.hymnNum2)}" placeholder="예: 289">
        </div>
        <div class="settings-field">
          <label>찬송가 악보 사진 2 (직접 올리기 — 없으면 악보 폴더에서 자동으로 찾습니다)</label>
          <input type="file" accept="image/*" class="hymn-image-input-2">
          ${item.hymnImage2 ? `<img class="hymn-image-preview" src="${item.hymnImage2}" alt="악보2 미리보기">` : ""}
          ${item.hymnImage2 ? `<button type="button" class="hymn-image-remove-btn-2 settings-reset-btn" style="padding:8px 0;">사진 삭제</button>` : ""}
          ${!item.hymnImage2 ? `<button type="button" class="hymn-auto-preview-btn-2 preset-btn" style="margin-top:8px;">🔍 악보 폴더에서 자동매칭 미리보기</button><div class="hymn-auto-preview-result-2"></div>` : ""}
        </div>
      </div>
    `;

    const rowNumEl = rowEl.querySelector(".item-row-num");

    // ── 이벤트 바인딩 (draftItems를 직접 갱신, 목록 전체를 다시 그리지
    //    않아 입력 중 포커스가 끊기지 않는다) ──
    // 제목·설명·유형은 순서 버튼을 누를 때 이미 알맞게 정해지므로
    // 여기서 따로 바꾸는 칸을 두지 않는다.

    panel.querySelector(".title-input").addEventListener("input", e => {
      draftItems[idx].title = e.target.value;
      rowEl.querySelector(".item-row-title").textContent = e.target.value || "(제목 없음)";
      const fixedTitleEl = panel.querySelector(".fixed-field-title");
      if (fixedTitleEl) fixedTitleEl.textContent = (e.target.value || "고정문구") + " 내용";
    });

    panel.querySelector(".num-input").addEventListener("input", e => {
      draftItems[idx].num = e.target.value;
      rowNumEl.textContent = draftItems[idx].sub ? "•" : (e.target.value || "-");
    });

    panel.querySelector(".sub-checkbox").addEventListener("change", e => {
      draftItems[idx].sub = e.target.checked;
      panel.querySelector(".num-input").disabled = e.target.checked;
      rowNumEl.textContent = e.target.checked ? "•" : (draftItems[idx].num || "-");
    });

    const contentInputEl = panel.querySelector(".content-input");
    contentInputEl.addEventListener("input", e => {
      draftItems[idx].content = e.target.value;
      autoGrowTextarea(contentInputEl);
    });

    const sermonContentEl = panel.querySelector(".sermon-content-input");
    sermonContentEl?.addEventListener("input", e => {
      draftItems[idx].sermonContent = e.target.value;
      autoGrowTextarea(sermonContentEl);
    });

    const fixedTextEl = panel.querySelector(".fixed-text-input");
    fixedTextEl?.addEventListener("input", e => {
      draftItems[idx].fixedText = e.target.value;
      autoGrowTextarea(fixedTextEl);
    });

    const gyodokmunTextEl = panel.querySelector(".gyodokmun-text-input");
    gyodokmunTextEl?.addEventListener("input", e => {
      draftItems[idx].gyodokmunText = e.target.value;
      autoGrowTextarea(gyodokmunTextEl);
    });

    const longContentEl = panel.querySelector(".long-content-input");
    longContentEl?.addEventListener("input", e => {
      draftItems[idx].longContent = e.target.value;
      autoGrowTextarea(longContentEl);
    });

    panel.querySelector(".scripture-ref-input").addEventListener("input", e => {
      draftItems[idx].scriptureRef = e.target.value;
      draftItems[idx].desc = e.target.value; // 순서 바 옆 입력칸·목록 표시와 항상 동기화
      const rowFieldEl = rowEl.querySelector(".item-row-field-input");
      if (rowFieldEl) rowFieldEl.value = e.target.value;
    });

    // 성경 출처를 입력하고 다른 칸으로 넘어가면(포커스 아웃), 본문이 아직
    // 비어 있을 때만 자동으로 채운다 — 이미 손으로 고쳐 둔 본문은 건드리지 않는다.
    panel.querySelector(".scripture-ref-input").addEventListener("blur", () => {
      autofillScriptureText(idx, panel, { force: false });
    });

    const scriptureAutofillBtn = panel.querySelector(".scripture-autofill-btn");
    if (scriptureAutofillBtn) {
      scriptureAutofillBtn.addEventListener("click", async () => {
        const original = scriptureAutofillBtn.textContent;
        scriptureAutofillBtn.textContent = "불러오는 중…";
        scriptureAutofillBtn.disabled = true;
        const ok = await autofillScriptureText(idx, panel, { force: true });
        scriptureAutofillBtn.textContent = original;
        scriptureAutofillBtn.disabled = false;
        if (!ok) {
          alert(lastScriptureLookupError || "본문을 찾지 못했습니다. 설정 상단 '성경 데이터 연결'에서 번역본이 연결되어 있는지, 성경주소 표기(예: 디모데후서 4:7~8)가 올바른지 확인해주세요.");
        }
      });
    }

    panel.querySelector(".scripture-text-input").addEventListener("input", e => {
      draftItems[idx].scriptureText = e.target.value;
    });

    panel.querySelector(".scripture-first-checkbox")?.addEventListener("change", e => {
      draftItems[idx].scriptureFirst = e.target.checked;
    });

    panel.querySelector(".hymn-num-input").addEventListener("input", e => {
      draftItems[idx].hymnNum = e.target.value;
      draftItems[idx].desc = e.target.value; // 순서 바 옆 입력칸·목록 표시와 항상 동기화
      const rowFieldEl = rowEl.querySelector(".item-row-field-input");
      if (rowFieldEl) rowFieldEl.value = e.target.value;
    });

    panel.querySelector(".hymn-image-input").addEventListener("change", e => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        draftItems[idx].hymnImage = reader.result;
        renderItemsEditor(); // 미리보기를 보여주기 위해 다시 그린다
      };
      reader.readAsDataURL(file);
    });

    const hymnImageRemoveBtn = panel.querySelector(".hymn-image-remove-btn");
    if (hymnImageRemoveBtn) {
      hymnImageRemoveBtn.addEventListener("click", () => {
        draftItems[idx].hymnImage = null;
        renderItemsEditor();
      });
    }

    const hymnAutoPreviewBtn = panel.querySelector(".hymn-auto-preview-btn");
    if (hymnAutoPreviewBtn) {
      hymnAutoPreviewBtn.addEventListener("click", async () => {
        const resultEl = panel.querySelector(".hymn-auto-preview-result");
        const original = hymnAutoPreviewBtn.textContent;
        hymnAutoPreviewBtn.textContent = "확인 중…";
        hymnAutoPreviewBtn.disabled = true;
        const clean = cleanHymnNum(draftItems[idx].hymnNum);
        const src = clean ? await resolveHymnImageAny(clean) : null;
        hymnAutoPreviewBtn.textContent = original;
        hymnAutoPreviewBtn.disabled = false;
        if (resultEl) {
          resultEl.innerHTML = src
            ? `<img class="hymn-image-preview" src="${src}" alt="자동매칭 미리보기">`
            : `<div class="settings-hint" style="margin:8px 0 0;">"${clean || "(번호 없음)"}"에 해당하는 악보를 찾지 못했습니다. 위 "자료 폴더 선택해서 연결하기"로 사진을 연결했는지, 또는 악보 폴더 경로에 그 이름의 파일이 있는지 확인해주세요.</div>`;
        }
      });
    }

    const hymnNumInput2 = panel.querySelector(".hymn-num-input-2");
    if (hymnNumInput2) {
      hymnNumInput2.addEventListener("input", e => {
        draftItems[idx].hymnNum2 = e.target.value;
      });
    }

    const hymnImageInput2 = panel.querySelector(".hymn-image-input-2");
    if (hymnImageInput2) {
      hymnImageInput2.addEventListener("change", e => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          draftItems[idx].hymnImage2 = reader.result;
          renderItemsEditor();
        };
        reader.readAsDataURL(file);
      });
    }

    const hymnImageRemoveBtn2 = panel.querySelector(".hymn-image-remove-btn-2");
    if (hymnImageRemoveBtn2) {
      hymnImageRemoveBtn2.addEventListener("click", () => {
        draftItems[idx].hymnImage2 = null;
        renderItemsEditor();
      });
    }

    const hymnAutoPreviewBtn2 = panel.querySelector(".hymn-auto-preview-btn-2");
    if (hymnAutoPreviewBtn2) {
      hymnAutoPreviewBtn2.addEventListener("click", async () => {
        const resultEl = panel.querySelector(".hymn-auto-preview-result-2");
        const original = hymnAutoPreviewBtn2.textContent;
        hymnAutoPreviewBtn2.textContent = "확인 중…";
        hymnAutoPreviewBtn2.disabled = true;
        const clean = cleanHymnNum(draftItems[idx].hymnNum2);
        const src = clean ? await resolveHymnImageAny(clean) : null;
        hymnAutoPreviewBtn2.textContent = original;
        hymnAutoPreviewBtn2.disabled = false;
        if (resultEl) {
          resultEl.innerHTML = src
            ? `<img class="hymn-image-preview" src="${src}" alt="자동매칭 미리보기">`
            : `<div class="settings-hint" style="margin:8px 0 0;">"${clean || "(번호 없음)"}"에 해당하는 악보를 찾지 못했습니다. 위 "자료 폴더 선택해서 연결하기"로 사진을 연결했는지, 또는 악보 폴더 경로에 그 이름의 파일이 있는지 확인해주세요.</div>`;
        }
      });
    }

    return panel;
  }

  function escapeAttr(v) {
    return (v || "").toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function escapeText(v) {
    return (v || "").toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  addItemBtn.addEventListener("click", () => {
    const item = {
      id: newId(),
      num: String(draftItems.filter(it => !it.sub).length + 1),
      sub: false,
      title: "새 순서",
      desc: "",
      type: "일반",
      content: ""
    };
    draftItems.push(item);
    expandedItemId = item.id; // 새로 추가한 항목을 바로 펼쳐서 이어서 입력하게 한다
    renderItemsEditor();
    itemsEditor.querySelector(".item-row.expanded")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  function sanitizeFilename(name) {
    return (name || "예배순서지").replace(/[\\/:*?"<>|]/g, "").trim() || "예배순서지";
  }

  // 지금 열려 있는 파일 이름을 그대로 돌려준다(예: "구역예배_순서지.html").
  // 저장 시 이 이름을 그대로 써야, 원래 폴더에서 저장할 때 이름이 자동으로
  // 일치해서 덮어쓰기가 바로 된다. 예배 이름을 다른 걸로 바꿔 입력해도
  // 파일 이름 자체는 안 바뀐다.
  function currentFileName() {
    try {
      const parts = decodeURIComponent(location.pathname).split("/");
      const last = parts[parts.length - 1];
      if (last && last.toLowerCase().endsWith(".html")) return last;
    } catch (e) {}
    return sanitizeFilename(serviceTitle) + "_순서지.html";
  }

  // 지금 화면에 있는 데이터를 새 HTML 파일 하나로 그대로 담아 다운로드한다.
  // 이 파일은 로컬 저장(localStorage)과 무관하게 그 안에 데이터를 가지고
  // 있으므로, 다른 컴퓨터로 옮겨서 열어도 내용이 그대로 보인다.
  function downloadExportedHtml() {
    const docClone = document.documentElement.cloneNode(true);
    docClone.querySelectorAll(".detail-overlay, .settings-overlay").forEach(el => el.classList.remove("open"));
    const dataScript = docClone.querySelector("#embeddedData");
    if (dataScript) dataScript.textContent = JSON.stringify({ serviceTitle, hymnFolder, items });

    const html = "<!DOCTYPE html>\n" + docClone.outerHTML;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = currentFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // 저장 시각을 파일 이름에 붙여서, 여러 번 저장해도 서로 구분되게 한다.
  function timestampForFilename() {
    const d = new Date();
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  }

  // 지금 화면 데이터(제목, 항목 전체)만 작은 JSON 파일로 내려받는다. 프로그램
  // 파일 자체는 그대로 두고 데이터만 따로 챙겨두는 용도 — 급할 때 폰에서
  // 저장해뒀다가, 나중에 "JSON 불러오기"로 다시 채워 넣을 수 있다.
  function downloadJsonData() {
    const data = { serviceTitle, hymnFolder, items };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = sanitizeFilename(serviceTitle) + "_" + timestampForFilename() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // "JSON 불러오기"로 고른 파일을 읽어 화면 데이터를 그 내용으로 채운다.
  // 예전 구조로 저장된 JSON이 섞여 있어도 migrateItem으로 지금 구조에 맞춘다.
  function loadJsonFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || !Array.isArray(parsed.items) || !parsed.items.length) {
          alert("이 파일에서 예배 순서 데이터를 찾지 못했습니다. 이 프로그램에서 저장한 JSON 파일이 맞는지 확인해주세요.");
          return;
        }
        serviceTitle = parsed.serviceTitle || defaultServiceTitle;
        hymnFolder = parsed.hymnFolder || defaultHymnFolder;
        items = parsed.items.map(migrateItem);
        draftItems = cloneItems(items);
        expandedItemId = null;
        if (serviceTitleInput) serviceTitleInput.value = serviceTitle;
        if (hymnFolderInput) hymnFolderInput.value = hymnFolder;
        saveState();
        renderItemsEditor();
        renderList();
        alert("JSON 파일의 내용을 불러왔습니다.");
      } catch (e) {
        alert("파일을 읽는 데 실패했습니다: " + e.message);
      }
    };
    reader.readAsText(file);
  }

  if (settingsJsonSaveBtn) {
    settingsJsonSaveBtn.addEventListener("click", () => {
      serviceTitle = serviceTitleInput.value.trim() || defaultServiceTitle;
      hymnFolder = hymnFolderInput.value.trim() || defaultHymnFolder;
      items = cloneItems(draftItems);
      saveState();
      downloadJsonData();
    });
  }

  if (settingsJsonLoadBtn && jsonLoadInput) {
    settingsJsonLoadBtn.addEventListener("click", () => jsonLoadInput.click());
    jsonLoadInput.addEventListener("change", () => {
      const file = jsonLoadInput.files && jsonLoadInput.files[0];
      if (file) loadJsonFile(file);
      jsonLoadInput.value = "";
    });
  }

  settingsSaveBtn.addEventListener("click", () => {
    serviceTitle = serviceTitleInput.value.trim() || defaultServiceTitle;
    hymnFolder = hymnFolderInput.value.trim() || defaultHymnFolder;
    items = cloneItems(draftItems);
    saveState();
    renderList();
    closeSettings();
  });

  settingsExportBtn.addEventListener("click", () => {
    serviceTitle = serviceTitleInput.value.trim() || defaultServiceTitle;
    hymnFolder = hymnFolderInput.value.trim() || defaultHymnFolder;
    items = cloneItems(draftItems);
    saveState();
    renderList();
    downloadExportedHtml();
    closeSettings();
  });

  settingsResetBtn.addEventListener("click", () => {
    if (!confirm("모든 항목을 기본 예배 순서로 되돌릴까요? 지금까지 편집한 내용은 사라집니다.")) return;
    draftItems = defaultItems();
    expandedItemId = null;
    serviceTitleInput.value = defaultServiceTitle;
    renderItemsEditor();
  });
