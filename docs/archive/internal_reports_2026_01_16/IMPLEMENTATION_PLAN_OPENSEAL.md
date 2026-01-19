# OpenSeal 통합 구현 계획서 (Integration Plan) - v2.1(Automation)

## 🎯 목표
HighStation을 **OpenSeal 검증자(Verifier)**로 업그레이드하고, Provider의 Identity 관리를 **자동화**합니다.

## User Review Required
> [!IMPORTANT]
> **OpenSeal CLI 업데이트**: 
> Provider들이 수동으로 `openseal.json`을 작성하는 실수를 방지하기 위해, **`openseal build` 명령어가 `openseal.json`을 자동 생성/업데이트**하도록 CLI를 수정해야 합니다.

- [x] **Database Schema Update**
    - [x] `openseal_repo_url` (Source URL)
    - [x] `openseal_root_hash` (Golden Truth)
    - [x] `openseal_verified_at` (Last Verification Time)
- [x] **OpenSeal Service Implementation**
    - [x] `OpenSealService.ts` (Manifest Fetcher)
    - [x] `POST /api/services/:id/openseal` (Registration Endpoint)

## Proposed Changes

### 1. OpenSeal Protocol & CLI Update

#### [MODIFY] [crates/openseal-cli/src/main.rs](file:///root/highpass/openseal/crates/openseal-cli/src/main.rs)
`build` 명령어 실행 시 다음 동작을 수행하도록 로직을 개선합니다.

1.  **Identity Calculation**: 기존과 동일하게 Source Code의 Merkle Tree 계산.
2.  **Manifest Automation**: 계산된 `Root Hash`와 `Timestamp`를 포함하여 **Source Directory의 `openseal.json` 파일을 자동 생성(또는 덮어쓰기)**합니다.
3.  **Self-Exclusion**: `ensure_config_files` 함수에서 `openseal.json`이 `.opensealignore`에 포함되어 있는지 확인하고 강제 추가합니다. (해시 순환 참조 방지)

**Result**: Provider는 `openseal build` 실행 후 `git add openseal.json && git commit`만 하면 됩니다.

### 2. Verification Logic: Two-Track Strategy

#### A. HighStation Integration (Node.js Application)
서버 애플리케이션 내에서 외부 프로세스 호출 없이 효율적으로 검증하기 위해 **Native TypeScript Module**을 구현합니다.

*   **Module**: `src/lib/openseal-verifier/` (로컬 패키지).
*   **Impl**: `verify_seal` 로직을 TypeScript로 포팅 (`blake3`, `@noble/ed25519`).
*   **Benefits**: Latency 최소화, Type Safety.
*   **Usage**: `ProxyService`에서 응답 검증 시 사용.

#### B. CLI Verification (Standalone & Dev Tool)
HighStation 외부에서 수동 검증하거나 개발자가 로컬에서 테스트할 때 사용하는 **기존 CLI 기능 (`openseal verify`)은 그대로 유지**합니다.
퀵스타트 가이드 및 외부 스크립트 호환성을 보장합니다.

### 3. Backend Implementation (HighStation)

#### [MODIFY] [src/services/OpenSealService.ts](file:///root/highpass/highstation/src/services/OpenSealService.ts)
**Register Process**:
- `git clone` 로직은 **설계에서 제외**합니다.
- Repository의 `raw.githubusercontent.com/.../openseal.json`을 Fetch합니다.
- Manifest 내의 `root_hash`를 DB에 저장합니다 (`Golden Truth`).

**Verify Process**:
- `opensealVerifier.verifySeal(...)` (TypeScript Module)을 호출합니다.

### HighStation Backend (`highstation`)

#### [MODIFY] [src/services/ProxyService.ts](file:///root/highpass/highstation/src/services/ProxyService.ts)
- **Use `OpensealVerifier`**: Import and use the verify logic.
- **Header Injection**: Inject `X-OpenSeal-Wax` (Random Challenge) into upstream request.
- **Verification**:
    - Extract `X-OpenSeal-Seal` from upstream response.
    - If `openseal_root_hash` is present in service config, perform verification.
    - Attach `X-OpenSeal-Verified` (true/false) and `X-OpenSeal-Message` to the client response.

#### [MODIFY] [src/middleware/serviceResolver.ts](file:///root/highpass/highstation/src/middleware/serviceResolver.ts)
- Update `ServiceConfig` interface to include `openseal_repo_url` and `openseal_root_hash`.

## Verification Plan

### Automated Verification
- **Unit Test**: `src/lib/openseal-verifier` (Already Verified)
- **Integration Test**:
    1. **Register Identity**: Use `POST /api/services/:id/openseal` to bind `sentence-laundry` with its GitHub repo.
    2. **Run OpenSeal App**: Ensure `sentence-laundry` is running on port 7325.
    3. **Proxy Request**: Send a request to HighStation Proxy targeting the service.
    4. **Check Headers**: Verify `X-OpenSeal-Verified: true` is present in the response.

### 4. Verification Plan
1.  **CLI Automation**: CLI 수정 후 `sentence-laundry`에서 `openseal build` 실행 시 `openseal.json`이 자동 생성되는지 확인.
2.  **Manifest Integrity**: 생성된 JSON이 `.opensealignore`에 의해 해싱에서 제외되어, 여러 번 빌드해도 Root Hash가 동일하게 유지되는지 확인.
3.  **Verify Interop**: Rust CLI가 생성한 서명을 HighStation의 TypeScript 모듈이 검증 통과(True)하는지 확인.
