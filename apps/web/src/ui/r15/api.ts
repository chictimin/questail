/**
 * R1.5 화면 공용 JSON 읽기 — UI는 API로 읽는다(db 직접 import 금지).
 * 실패는 throw(호출 측이 상태로 둔다).
 */
export async function getJson(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(String(response.status));
  }
  return response.json() as Promise<unknown>;
}
