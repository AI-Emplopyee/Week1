import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructOcrText, ocrQuality } from '../lib/ocr-layout.ts';

test('OCR rebuilds columns without changing source digits or merging distinct lines', () => {
  const word = (text:string,x0:number,x1:number,y0:number,y1:number) => ({text,bbox:{x0,x1,y0,y1}});
  const result = reconstructOcrText({confidence:82,text:'unused',blocks:[{paragraphs:[{lines:[
    {bbox:{y1:22},words:[word('Quantity',10,65,5,22),word('Amount',180,230,9,20)]},
    {bbox:{y1:44},words:[word('12',10,23,30,44),word('1,234.50',180,240,29,43)]},
  ]}]}]});
  assert.equal(result, 'Quantity\tAmount\n12\t1,234.50');
});
test('fallback keeps OCR text unchanged and rotation quality discounts short gibberish', () => {
  assert.equal(reconstructOcrText({text:'Uncertain 1O/10',confidence:10,blocks:null}), 'Uncertain 1O/10');
  assert.ok(ocrQuality({text:'Invoice number TEST-100 quantity twelve items total amount',confidence:85}) > ocrQuality({text:'z',confidence:99}));
});
