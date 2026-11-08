const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export async function sendChatMessage(message, history, analysis) {
  const token = localStorage.getItem('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE_URL}/chat`, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify({ message, history, analysis }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.message || 'Could not reach the AI assistant.');
  }
  return data.reply;
}