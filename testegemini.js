import { GoogleGenAI } from '@google/genai';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const CURTO = 'Responda apenas: ok';
const LONGO = 'Escreva um texto de aproximadamente 250 palavras, em português, descrevendo um colar elizabetano macio para cães e gatos.';

async function medir(nome, funcao, limiteMs = 90000) {
  const inicio = Date.now();
  const tempo = () => ((Date.now() - inicio) / 1000).toFixed(1) + 's';

  try {
    const resultado = await Promise.race([
      funcao(),
      new Promise((_, rejeitar) =>
        setTimeout(() => rejeitar(new Error(`sem resposta em ${limiteMs / 1000}s`)), limiteMs)
      )
    ]);
    console.log(`✓ ${nome} (${tempo()}): ${resultado}`);
  } catch (erro) {
    console.log(`✗ ${nome} (${tempo()}): ${String(erro.message).slice(0, 200)}`);
  }
}

const viaGenerate = async (prompt) => {
  const r = await ai.models.generateContent({ model: MODEL, contents: prompt });
  return `${(r.text || '').length} caracteres`;
};

const viaInteractions = async (prompt) => {
  const r = await ai.interactions.create({
    model: MODEL,
    store: false,
    input: prompt,
    generation_config: { max_output_tokens: 1500, thinking_level: 'low' }
  });
  return `${(r.output_text || '').length} caracteres`;
};

console.log('Modelo:', MODEL, '| chave definida:', Boolean(process.env.GEMINI_API_KEY));

await medir('A. generateContent, resposta curta', () => viaGenerate(CURTO));
await medir('B. interactions, resposta curta', () => viaInteractions(CURTO));
await medir('C. generateContent, texto de ~250 palavras', () => viaGenerate(LONGO));
await medir('D. interactions, texto de ~250 palavras', () => viaInteractions(LONGO));

console.log('Fim do teste.');
process.exit(0);