// ================================================================
//  영감노트 (InsightNote) — Google Apps Script 백엔드
//  복사 후 Apps Script 편집기에 붙여넣고 새 버전으로 배포하세요.
//  배포 설정: 실행 계정 = 나 / 엑세스 = 모든 사용자
// ================================================================

// ── 설정 ──────────────────────────────────────────────────────────
const SHEET_NAME  = 'Notes';
const FOLDER_NAME = '영감노트_파일';

// 비밀번호 ← 여기만 수정하세요
const ACCESS_KEY = '2865';

// 배포 버전 확인용 — 웹앱 URL을 브라우저로 열면 이 값이 보입니다.
// 새 코드가 실제로 배포되었는지 확인할 때 사용하세요.
const VERSION = '2026-06-03-multifile-v3';

// 컬럼 순서 — 스프레드시트 실제 순서와 일치
// id | category | folder | title | content | link | file_url | tags | date | created_at | file_urls
//  · file_url  : 첫 번째 파일 URL (구버전 호환용 단일 값)
//  · file_urls : 첨부된 모든 파일 URL을 JSON 배열로 저장 (여러 이미지 보존)
// 기존 시트에 file_urls 컬럼이 없어도 getSheet()에서 자동으로 추가되며, 기존 데이터는 유지됩니다.
const SHEET_HEADERS = [
  'id', 'category', 'folder', 'title', 'content',
  'link', 'file_url', 'tags', 'date', 'created_at', 'file_urls'
];


// ── 유틸리티 ──────────────────────────────────────────────────────

/** JSON 응답 생성 */
function responseJSON(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * 시트를 가져오거나 없으면 생성합니다.
 * 시트가 비어 있으면 헤더 행을 자동으로 추가합니다.
 */
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    Logger.log('새 시트 생성: ' + SHEET_NAME);
  }

  // 헤더 자동 초기화 (빈 시트인 경우)
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(SHEET_HEADERS);
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setFontWeight('bold');
    Logger.log('헤더 자동 생성 완료');
  } else {
    // 헤더 마이그레이션: 누락된 컬럼(예: file_urls)을 데이터 손실 없이 자동 추가
    const headerRow = sheet.getRange(1, 1, 1, SHEET_HEADERS.length).getValues()[0];
    for (let c = 0; c < SHEET_HEADERS.length; c++) {
      if (String(headerRow[c] || '') !== SHEET_HEADERS[c]) {
        sheet.getRange(1, c + 1).setValue(SHEET_HEADERS[c]).setFontWeight('bold');
        Logger.log('헤더 컬럼 보정: ' + SHEET_HEADERS[c] + ' (열 ' + (c + 1) + ')');
      }
    }
  }

  return sheet;
}

/**
 * ★ 수동 실행용 ★
 * Apps Script 편집기 상단의 함수 선택 메뉴에서 'setupSheet'을 고른 뒤 [실행]을 누르세요.
 * 1) file_urls 컬럼(헤더)이 없으면 생성하고
 * 2) 기존 행의 file_url 값을 새 구조(file_url=첫 URL, file_urls=전체 JSON)로 백필합니다.
 * 배포 여부와 상관없이, 저장된 최신 코드로 즉시 시트를 정비합니다. 기존 데이터는 보존됩니다.
 */
function setupSheet() {
  const sheet   = getSheet(); // 헤더 보정(file_urls 컬럼 생성) 포함
  const lastRow = sheet.getLastRow();
  let migrated  = 0;

  if (lastRow > 1) {
    const range  = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.length);
    const values = range.getValues();
    for (let i = 0; i < values.length; i++) {
      const row          = values[i];
      const existingList = String(row[10] || ''); // file_urls 컬럼
      const legacy       = String(row[6]  || ''); // file_url 컬럼
      // file_urls가 비어 있고 기존 file_url에 값이 있을 때만 백필 (이미 정비된 행은 건너뜀)
      if (!existingList && legacy) {
        const urls = parseFileUrls('', legacy);
        const ff   = buildFileFields(urls);
        row[6]  = ff.file_url;
        row[10] = ff.file_urls;
        migrated++;
      }
    }
    range.setValues(values);
  }

  const msg = 'setupSheet 완료 — file_urls 컬럼 확인/생성, 기존 데이터 ' + migrated + '행 정비';
  Logger.log(msg);
  return msg;
}

/** Drive 폴더를 가져오거나 없으면 생성합니다 */
function getOrCreateFolder() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
}

/**
 * URL 배열 → 시트에 저장할 file_url(첫 URL)과 file_urls(JSON 배열) 값으로 변환합니다.
 * 여러 파일을 모두 보존하기 위해 항상 file_urls 컬럼에 전체 목록을 저장합니다.
 */
function buildFileFields(urls) {
  const clean = (urls || []).filter(function(u) { return !!u; });
  return {
    file_url:  clean[0] || '',
    file_urls: clean.length ? JSON.stringify(clean) : ''
  };
}

/**
 * 시트 셀 값(file_urls 컬럼 우선, 없으면 구버전 file_url 컬럼)에서 URL 배열을 복원합니다.
 * 구버전 데이터(file_url 에 단일 URL 또는 JSON 배열 저장)도 호환합니다.
 */
function parseFileUrls(fileUrlsCell, fileUrlCell) {
  const rawList = String(fileUrlsCell || '');
  if (rawList) {
    try {
      const p = JSON.parse(rawList);
      if (Array.isArray(p)) return p.filter(function(u) { return !!u; });
    } catch (e) {}
  }
  // 구버전 호환: file_url 컬럼에 단일 URL 또는 JSON 배열이 저장된 경우
  const legacy = String(fileUrlCell || '');
  if (!legacy) return [];
  if (legacy.charAt(0) === '[') {
    try {
      const p2 = JSON.parse(legacy);
      if (Array.isArray(p2)) return p2.filter(function(u) { return !!u; });
    } catch (e) {}
  }
  return [legacy];
}


// ── 메인 핸들러 ───────────────────────────────────────────────────

/** GET 요청 — 연결 테스트 및 읽기 처리 */
function doGet(e) {
  const params = (e && e.parameter) ? e.parameter : {};

  // action=read 요청: 키 검증 후 데이터 반환
  if (params.action === 'read') {
    if (!params.key || params.key !== ACCESS_KEY) {
      return responseJSON({ status: 'error', message: '키가 올바르지 않습니다.' });
    }
    return handleRead();
  }

  // 기본 상태 확인 (배포 버전 확인용)
  return responseJSON({ status: 'success', message: '영감노트 GAS 서버 정상 작동 중', version: VERSION });
}

/** POST 요청 — 모든 앱 요청 처리 */
function doPost(e) {
  // 1. JSON 파싱
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    Logger.log('JSON 파싱 오류: ' + err.toString());
    return responseJSON({ status: 'error', message: 'JSON 파싱 오류: ' + err.message });
  }

  // 2. 비밀번호(키) 검증
  if (!data.key || data.key !== ACCESS_KEY) {
    Logger.log('키 불일치 — 수신된 키: ' + (data.key || '없음'));
    return responseJSON({ status: 'error', message: '키가 올바르지 않습니다.' });
  }

  // 3. 액션 라우팅
  const action = data.action;
  Logger.log('요청 액션: ' + action + ' / ID: ' + (data.id || 'N/A'));

  try {
    if (action === 'read')        return handleRead();
    if (action === 'create')      return handleCreate(data);
    if (action === 'update')      return handleUpdate(data);
    if (action === 'delete')      return handleDelete(data);
    if (action === 'saveFolders') return handleSaveFolders(data);

    return responseJSON({ status: 'error', message: '알 수 없는 액션: ' + action });
  } catch (err) {
    Logger.log('[' + action + '] 처리 중 오류: ' + err.toString());
    return responseJSON({ status: 'error', message: '서버 오류: ' + err.message });
  }
}


// ── 액션 핸들러 ───────────────────────────────────────────────────

/** 전체 메모 읽기 */
function handleRead() {
  const sheet   = getSheet();
  const lastRow = sheet.getLastRow();

  // 헤더만 있거나 완전히 비어있을 때
  if (lastRow <= 1) {
    return responseJSON({ status: 'success', data: [], folders: getStoredFolders() });
  }

  const rows  = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.length).getValues();
  const notes = rows
    // ID가 없는 빈 행 제거
    .filter(row => row[0] !== '' && row[0] !== null && row[0] !== undefined)
    .map(row => {
      // 컬럼 순서: id(0) category(1) folder(2) title(3) content(4) link(5) file_url(6) tags(7) date(8) created_at(9) file_urls(10)
      let tags = [];
      try { tags = row[7] ? JSON.parse(row[7]) : []; } catch (e) { tags = []; }

      var parsedUrls = parseFileUrls(row[10], row[6]);
      return {
        id:         String(row[0] || ''),
        category:   String(row[1] || ''),
        folder:     String(row[2] || '기타'),
        title:      String(row[3] || ''),
        content:    String(row[4] || ''),
        link:       String(row[5] || ''),
        file_url:   parsedUrls[0] || '',
        file_urls:  parsedUrls,
        tags:       tags,
        date:       String(row[8] || ''),
        created_at: row[9] ? Number(row[9]) : 0
      };
    });

  Logger.log('읽기 완료 — 메모 수: ' + notes.length);
  return responseJSON({ status: 'success', data: notes, folders: getStoredFolders() });
}

/** 새 메모 생성 */
function handleCreate(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet    = getSheet();
    var filesArr   = Array.isArray(data.files) ? data.files : (data.file ? [data.file] : []);
    var uploadedUrls = filesArr.map(function(f) { return uploadFileIfPresent(f); }).filter(function(u) { return !!u; });
    var ff         = buildFileFields(uploadedUrls);

    // 컬럼 순서: id | category | folder | title | content | link | file_url | tags | date | created_at | file_urls
    sheet.appendRow([
      String(data.id         || String(Date.now())),
      String(data.category   || ''),
      String(data.folder     || '기타'),
      String(data.title      || ''),
      String(data.content    || ''),
      String(data.link       || ''),
      ff.file_url,
      JSON.stringify(data.tags || []),
      String(data.date       || ''),
      Number(data.created_at || Date.now()),
      ff.file_urls
    ]);

    Logger.log('생성 완료 — ID: ' + data.id + ' / 파일 ' + uploadedUrls.length + '개');
    return responseJSON({ status: 'success', file_url: uploadedUrls[0] || '', file_urls: uploadedUrls });
  } finally {
    lock.releaseLock();
  }
}

/** 기존 메모 수정 */
function handleUpdate(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet    = getSheet();
    const lastRow  = sheet.getLastRow();
    const targetId = String(data.id || '');

    if (!targetId) return responseJSON({ status: 'error', message: 'ID가 없습니다.' });
    if (lastRow <= 1) return responseJSON({ status: 'error', message: '메모를 찾을 수 없습니다.' });

    // 해당 ID의 행 번호 찾기
    const idCol   = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    let rowIndex  = -1;
    for (let i = 0; i < idCol.length; i++) {
      if (String(idCol[i][0]) === targetId) { rowIndex = i + 2; break; }
    }
    if (rowIndex === -1) {
      Logger.log('수정 대상 없음 — ID: ' + targetId);
      return responseJSON({ status: 'error', message: '해당 ID의 메모를 찾을 수 없습니다.' });
    }

    // 파일: existingFileUrls + 새 파일 업로드 → 전체 목록을 file_urls(JSON)로 저장
    var resultUrls;
    if (data.existingFileUrls !== undefined) {
      var existingToKeep = (data.existingFileUrls || []).filter(function(u) { return !!u; });
      var filesArr = Array.isArray(data.files) ? data.files : [];
      var newUrls  = filesArr.map(function(f) { return uploadFileIfPresent(f); }).filter(function(u) { return !!u; });
      resultUrls   = existingToKeep.concat(newUrls);
    } else if (data.file && data.file.data) {
      var single = uploadFileIfPresent(data.file);
      resultUrls = single ? [single] : [];
    } else {
      // 파일 변경 정보 없음: 기존 셀 값을 그대로 유지
      resultUrls = parseFileUrls(sheet.getRange(rowIndex, 11).getValue(), sheet.getRange(rowIndex, 7).getValue());
    }
    var ff = buildFileFields(resultUrls);

    // 컬럼 순서: id | category | folder | title | content | link | file_url | tags | date | created_at | file_urls
    sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).setValues([[
      String(data.id         || ''),
      String(data.category   || ''),
      String(data.folder     || '기타'),
      String(data.title      || ''),
      String(data.content    || ''),
      String(data.link       || ''),
      ff.file_url,
      JSON.stringify(data.tags || []),
      String(data.date       || ''),
      Number(data.created_at || 0),
      ff.file_urls
    ]]);

    Logger.log('수정 완료 — ID: ' + targetId + ' (행: ' + rowIndex + ') / 파일 ' + resultUrls.length + '개');
    return responseJSON({ status: 'success', file_url: resultUrls[0] || '', file_urls: resultUrls });
  } finally {
    lock.releaseLock();
  }
}

/** 메모 삭제 */
function handleDelete(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet    = getSheet();
    const lastRow  = sheet.getLastRow();
    const targetId = String(data.id || '');

    if (!targetId) return responseJSON({ status: 'error', message: 'ID가 없습니다.' });
    if (lastRow <= 1) return responseJSON({ status: 'error', message: '메모를 찾을 수 없습니다.' });

    // 아래에서부터 탐색 (deleteRow 후 인덱스 어긋남 방지)
    const idCol  = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    let rowIndex = -1;
    for (let i = idCol.length - 1; i >= 0; i--) {
      if (String(idCol[i][0]) === targetId) { rowIndex = i + 2; break; }
    }
    if (rowIndex === -1) {
      Logger.log('삭제 대상 없음 — ID: ' + targetId);
      return responseJSON({ status: 'error', message: '해당 ID의 메모를 찾을 수 없습니다.' });
    }

    sheet.deleteRow(rowIndex);
    Logger.log('삭제 완료 — ID: ' + targetId + ' (행: ' + rowIndex + ')');
    return responseJSON({ status: 'success' });
  } finally {
    lock.releaseLock();
  }
}


// ── 파일 업로드 ───────────────────────────────────────────────────

// ── 폴더 관리 ───────────────────────────────────────────────────────

/**
 * ScriptProperties에서 폴더 목록을 읽어 반환합니다.
 * 저장된 값이 없으면 null 반환 (프론트에서 로컬 폴더를 서버로 최초 동기화)
 */
function getStoredFolders() {
  const props  = PropertiesService.getScriptProperties();
  const stored = props.getProperty('customFolders');
  if (stored) {
    try { return JSON.parse(stored); } catch(e) {}
  }
  return null; // 아직 서버에 폴더가 저장된 적 없음
}

/** 폴더 목록을 ScriptProperties에 저장 */
function handleSaveFolders(data) {
  if (!data.folders || !Array.isArray(data.folders)) {
    return responseJSON({ status: 'error', message: '폴더 데이터가 없습니다.' });
  }
  const props = PropertiesService.getScriptProperties();
  props.setProperty('customFolders', JSON.stringify(data.folders));
  Logger.log('폴더 저장 완료: ' + JSON.stringify(data.folders));
  return responseJSON({ status: 'success' });
}


// ── 파일 업로드 ───────────────────────────────────────────────────

/**
 * 파일 데이터가 있으면 Drive에 업로드하고 다운로드 URL을 반환합니다.
 * 업로드 실패 시 빈 문자열을 반환하며 텍스트 저장은 계속 진행됩니다.
 */
function uploadFileIfPresent(fileData) {
  if (!fileData || !fileData.data || !fileData.name) return '';

  try {
    // data:image/png;base64,XXXX → XXXX 부분만 추출
    const parts  = fileData.data.split(',');
    const base64 = parts.length > 1 ? parts[1] : parts[0];
    if (!base64) return '';

    const bytes  = Utilities.base64Decode(base64);
    const blob   = Utilities.newBlob(
      bytes,
      fileData.type || 'application/octet-stream',
      fileData.name
    );

    const folder = getOrCreateFolder();
    const file   = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const url = file.getDownloadUrl();
    Logger.log('파일 업로드 완료: ' + fileData.name + ' → ' + url);
    return url;
  } catch (err) {
    // 파일 오류가 있어도 텍스트 저장은 중단하지 않습니다
    Logger.log('파일 업로드 오류 (텍스트 저장 계속): ' + err.toString());
    return '';
  }
}
