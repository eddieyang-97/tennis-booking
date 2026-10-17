// Only fixed classifications cross the diagnostic boundary; never copy arbitrary
// merchant text, tokens, URLs or card fields into traces.
const rules=[
 ['RECEIPT_CONFLICT',/Conflicting paid receipt|Account receipt identity mismatch/i,'payment-reconciliation'],
 ['EXISTING_PURCHASE_READ_ONLY',/Existing-purchase payment page requires/i,'user-action'],
 ['PURCHASE_MISSING',/Unique matching purchase.*observed 0 matches|Unique matching purchase not found(?!.*observed)/i,'manual-review'],
 ['PURCHASE_AMBIGUOUS',/Unique matching purchase.*observed (?:[2-9]|[1-9]\d+) matches/i,'manual-review'],
 ['PURCHASE_LAYOUT_UNKNOWN',/Purchase history layout/i,'manual-review'],
 ['PURCHASE_STATE_UNSAFE',/purchase is paid or uncertain|purchase is not confirmed paid|Test payment is paid or uncertain|payment state changed/i,'payment-reconciliation'],
 ['REFERENCE_UNAVAILABLE',/reference unavailable|No recorded payment reference|Invalid recovery reference/i,'manual-review'],
 ['AUTHENTICATION_REQUIRED',/human verification|sign-in|Account login|authentication required/i,'user-action'],
 ['PAGE_LOADING',/still loading|DOM not ready|DOM not stable/i,'read-only-observation'],
 ['MERCHANT_CHECKOUT_ERROR',/Merchant reported Something went wrong/i,'manual-review'],
 ['CHECKOUT_READY_TIMEOUT',/Card checkout readiness timed out/i,'read-only-observation'],
 ['CHECKOUT_OPEN_UNRESOLVED',/Checkout opening is unresolved/i,'read-only-observation'],
 ['BASKET_MISMATCH',/Basket.*mismatch|Unexpected basket item count|unrelated or changed items|Basket price/i,'manual-review'],
 ['BASKET_NOT_EMPTY',/Existing basket items|Remove.*selection|basket is not.*empty/i,'user-action'],
 ['TAB_UNAVAILABLE',/No tab with id|Read-only page unavailable|Could not establish connection|Receiving end does not exist/i,'read-only-observation'],
 ['PAYMENT_UNRESOLVED',/payment outcome unresolved|no repeat charge|payment requires.*reconciliation|No durable payment/i,'payment-reconciliation'],
 ['ACTION_BUSY',/already running|Another run is active|Another checkout requires/i,'read-only-observation'],
 ['AUTHORIZATION_INVALID',/authorized|Invalid.*(?:slot|price|settings)|Outside.*window|Date is outside|Time range/i,'user-action']
];
const known=new Set([...rules.map(([code])=>code),'UNCLASSIFIED_FAILURE','PAGE_TAB_ERROR','PAGE_READY_TIMEOUT','PAGE_AUTHENTICATION_REQUIRED','PAGE_UNEXPECTED_ORIGIN','PAGE_BASKET_ROUTE_CHANGED','GRID_AUTHENTICATION_REQUIRED','GRID_UNEXPECTED_ORIGIN','GRID_READY_TIMEOUT']);
export function failureFor(error,{operation,paymentPossible=false}={}){
 const message=typeof error==='string'?error:error?.message||error?.error||'';
 const found=rules.find(([,pattern])=>pattern.test(message));
 const supplied=error?.reasonCode||error?.errorCode||error?.diagnostic?.errorCode||error?.pageCode||error?.gridCode;
 const reasonCode=known.has(supplied)?supplied:found?.[0]||'UNCLASSIFIED_FAILURE';
 return {reasonCode,...(operation?{operation}:{}),recovery:{mode:paymentPossible?'payment-reconciliation':found?.[2]||'manual-review',automaticReplayAllowed:false}};
}
