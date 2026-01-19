# Supabase Auth-Only Setup Guide

## 개요

HighStation은 **하이브리드 아키텍처**를 사용합니다:
- **Supabase**: 인증(Auth) 전용
- **N100 PostgreSQL**: 모든 비즈니스 데이터

## 왜 이렇게 하나요?

1. **Supabase의 강점 활용**: GitHub OAuth, 이메일 인증 등 Auth 기능
2. **데이터 주권**: 중요한 비즈니스 데이터는 자체 서버에 보관
3. **비용 절감**: Supabase 무료 플랜으로 충분 (Auth만 사용)
4. **성능**: N100 로컬 DB가 더 빠름

## Supabase 설정 단계

### 1. Supabase 프로젝트 생성
1. https://supabase.com 접속
2. 새 프로젝트 생성
3. **Database Password** 설정 (사용하지 않지만 필수)

### 2. SQL 실행
1. Supabase Dashboard → **SQL Editor**
2. `sql/supabase_auth_only.sql` 파일 내용 복사
3. **Run** 클릭

### 3. GitHub OAuth 설정
1. Supabase Dashboard → **Authentication** → **Providers**
2. **GitHub** 활성화
3. GitHub OAuth App 생성:
   - Homepage URL: `https://www.highstation.net`
   - Callback URL: `https://aixgsvgbyvopllmfiame.supabase.co/auth/v1/callback`
4. Client ID와 Secret을 Supabase에 입력

### 4. 환경 변수 설정 (N100)

`.env` 파일에 추가:
```bash
# Supabase (Auth Only)
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# N100 PostgreSQL (Business Data)
DATABASE_URL=postgresql://user:password@localhost:5432/highstation
```

## 백엔드 Profile 자동 생성

### 문제
Supabase에서 로그인해도 N100 DB에 profile이 없으면 500 에러 발생

### 해결책
`authMiddleware`에 자동 생성 로직 추가:

```typescript
// src/middleware/authMiddleware.ts

export const authMiddleware = async (req, res, next) => {
    // ... 기존 인증 로직 ...
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
        return res.status(401).json({ error: 'Invalid token' });
    }
    
    // ✨ N100 DB에 profile 자동 생성
    await ensureProfile(user.id, user.email);
    
    res.locals.user = user;
    next();
};

async function ensureProfile(userId: string, email: string) {
    const result = await query(
        'SELECT id FROM profiles WHERE id = $1',
        [userId]
    );
    
    if (result.rows.length === 0) {
        await query(
            'INSERT INTO profiles (id, email, created_at) VALUES ($1, $2, NOW())',
            [userId, email]
        );
        console.log(`[Auth] Created profile for ${email}`);
    }
}
```

## 데이터베이스 초기화 시 주의사항

**N100 DB를 초기화할 때**:
```sql
-- ❌ 이렇게 하면 안됨 (profiles도 삭제)
DELETE FROM profiles;

-- ✅ 이렇게 해야 함 (서비스만 삭제)
DELETE FROM services;
DELETE FROM requests;
```

**또는** 초기화 후 수동으로 profile 재생성:
```bash
docker exec highstation_server node scripts/sync-profiles.js
```

## 테스트

1. **로그인 테스트**:
   - https://www.highstation.net 접속
   - GitHub로 로그인
   - 대시보드 정상 표시 확인

2. **Profile 확인**:
   ```bash
   docker exec highstation_server node -e "
   const { Pool } = require('pg');
   const pool = new Pool({ connectionString: process.env.DATABASE_URL });
   pool.query('SELECT id, email FROM profiles')
     .then(res => console.log(res.rows))
     .finally(() => pool.end());
   "
   ```

## 트러블슈팅

### 500 에러: "Failed to fetch stats"
**원인**: N100 DB에 profile이 없음

**해결**:
```bash
# 수동으로 profile 생성
docker exec highstation_server node -e "
const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const { data: { users } } = await supabase.auth.admin.listUsers();
  for (const user of users) {
    await pool.query(
      'INSERT INTO profiles (id, email, created_at) VALUES (\$1, \$2, NOW()) ON CONFLICT DO NOTHING',
      [user.id, user.email]
    );
  }
  await pool.end();
})();
"
```

### GitHub OAuth 리다이렉트 에러
**원인**: Callback URL 불일치

**해결**: GitHub OAuth App 설정에서 Callback URL 확인:
```
https://YOUR_PROJECT.supabase.co/auth/v1/callback
```

## 참고

- Supabase Auth 문서: https://supabase.com/docs/guides/auth
- N100 DB 스키마: `sql/master_schema_v2.2.sql`
