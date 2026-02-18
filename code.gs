// ================================================================
//  영감노트 (InsightNote) — Google Apps Script 백엔드
//  복사 후 Apps Script 편집기에 붙여넣고 새 버전으로 배포하세요.
//  배포 설정: 실행 계정 = 나 / 엑세스 = 모든 사용자
// ================================================================

// ── 설정 ──────────────────────────────────────────────────────────
const SHEET_NAME  = 'Notes';
const FOLDER_NAME = '영감노트_파일';

// 비밀번호는 스크립트 속성(Script Properties)에 ACCESS_KEY 키로 저장하세요.
// (스크립트 편집기 → 프로젝트 설정 → 스크립트 속성)
const ACCESS_KEY = PropertiesService.getScriptProperties()
                    .getProperty('ACCESS_KEY') || 'changeme';

// 컬럼 순서 — 스프레드시트 실제 순서와 일치
// id | category | folder | title | content | link | file_url | tags | date | created_at
const SHEET_HEADERS = [
  'id', 'category', 'folder', 'title', 'content',
  'link', 'file_url', 'tags', 'date', 'created_at'
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
  }

  return sheet;
}

/** Drive 폴더를 가져오거나 없으면 생성합니다 */
function getOrCreateFolder() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
}


// ── 메인 핸들러 ───────────────────────────────────────────────────

/** GET 요청 — 서버 동작 확인용 */
function doGet(e) {
  return responseJSON({ status: 'ok', message: '영감노트 GAS 서버 정상 작동 중' });
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
    if (action === 'read')   return handleRead();
    if (action === 'create') return handleCreate(data);
    if (action === 'update') return handleUpdate(data);
    if (action === 'delete') return handleDelete(data);

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
    return responseJSON({ status: 'success', data: [] });
  }

  const rows  = sheet.getRange(2, 1, lastRow - 1, SHEET_HEADERS.length).getValues();
  const notes = rows
    // ID가 없는 빈 행 제거
    .filter(row => row[0] !== '' && row[0] !== null && row[0] !== undefined)
    .map(row => {
      // 컬럼 순서: id(0) category(1) folder(2) title(3) content(4) link(5) file_url(6) tags(7) date(8) created_at(9)
      let tags = [];
      try { tags = row[7] ? JSON.parse(row[7]) : []; } catch (e) { tags = []; }

      return {
        id:         String(row[0] || ''),
        category:   String(row[1] || ''),
        folder:     String(row[2] || '기타'),
        title:      String(row[3] || ''),
        content:    String(row[4] || ''),
        link:       String(row[5] || ''),
        file_url:   String(row[6] || ''),
        tags:       tags,
        date:       String(row[8] || ''),
        created_at: row[9] ? Number(row[9]) : 0
      };
    });

  Logger.log('읽기 완료 — 메모 수: ' + notes.length);
  return responseJSON({ status: 'success', data: notes });
}

/** 새 메모 생성 */
function handleCreate(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet   = getSheet();
    const fileUrl = uploadFileIfPresent(data.file);

    // 컬럼 순서: id | category | folder | title | content | link | file_url | tags | date | created_at
    sheet.appendRow([
      String(data.id         || String(Date.now())),
      String(data.category   || ''),
      String(data.folder     || '기타'),
      String(data.title      || ''),
      String(data.content    || ''),
      String(data.link       || ''),
      fileUrl,
      JSON.stringify(data.tags || []),
      String(data.date       || ''),
      Number(data.created_at || Date.now())
    ]);

    Logger.log('생성 완료 — ID: ' + data.id);
    return responseJSON({ status: 'success' });
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

    // 파일: 새 파일이 있으면 업로드, 없으면 기존 URL 유지 (file_url = 7번째 컬럼)
    let fileUrl;
    if (data.file && data.file.data) {
      fileUrl = uploadFileIfPresent(data.file);
    } else {
      fileUrl = String(sheet.getRange(rowIndex, 7).getValue() || '');
    }

    // 컬럼 순서: id | category | folder | title | content | link | file_url | tags | date | created_at
    sheet.getRange(rowIndex, 1, 1, SHEET_HEADERS.length).setValues([[
      String(data.id         || ''),
      String(data.category   || ''),
      String(data.folder     || '기타'),
      String(data.title      || ''),
      String(data.content    || ''),
      String(data.link       || ''),
      fileUrl,
      JSON.stringify(data.tags || []),
      String(data.date       || ''),
      Number(data.created_at || 0)
    ]]);

    Logger.log('수정 완료 — ID: ' + targetId + ' (행: ' + rowIndex + ')');
    return responseJSON({ status: 'success' });
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
