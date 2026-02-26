import { api } from '../../../utils/api';

type WhisperStatus = 'transcribing';

type WhisperResponse = {
  text?: string;
  error?: string;
};

export async function transcribeWithWhisper(
  audioBlob: Blob,
  onStatusChange?: (status: WhisperStatus) => void,
): Promise<string> {
  const formData = new FormData();
  const fileName = `recording_${Date.now()}.webm`;
  const file = new File([audioBlob], fileName, { type: audioBlob.type });

  formData.append('audio', file);

  const whisperMode = window.localStorage.getItem('whisperMode') || 'default';
  formData.append('mode', whisperMode);

  try {
    // Keep existing status callback behavior.
    if (onStatusChange) {
      onStatusChange('transcribing');
    }

    const response = (await api.transcribe(formData)) as Response;

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as WhisperResponse;
      throw new Error(
        errorData.error ||
          `Transcription error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as WhisperResponse;
    return data.text || '';
  } catch (error) {
    if (
      error instanceof Error
      && error.name === 'TypeError'
      && error.message.includes('fetch')
    ) {
      throw new Error('Cannot connect to server. Please ensure the backend is running.');
    }
    throw error;
  }
}

