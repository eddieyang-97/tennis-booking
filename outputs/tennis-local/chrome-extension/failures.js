// Only fixed classifications cross the diagnostic boundary; never copy arbitrary
// merchant text, tokens, URLs or card fields into traces.
const rules=[
 ['RECEIPT_CONFLICT',/Conflicting paid receipt|Account receipt identity mismatch/i],
 ['EXISTING_PURCHASE_READ_ONLY',/Existing-purchase payment page requires/i],
 ['PURCHASE_MISSING',/Unique matching purchase.*observed 0 matches|Unique matching purchase not found(?!.*observed)/i],
 ['PURCHASE_AMBIGUOUS',/Unique matching purchase.*observed (?:[2-9]|[1-9]\d+) matches/i],
 ['PURCHASE_LAYOUT_UNKNOWN',/Purchase history layout/i],
 ['PURCHASE_STATE_UNSAFE',/purchase is paid or uncertain|purchase is not confirmed paid|Test payment is paid or uncertain|payment state changed/i],
 ['REFERENCE_UNAVAILABLE',/reference unavailable|No recorded payment reference|Invalid recovery reference/i],
 ['AUTHENTICATION_REQUIRED',/human verification|sign-in|Account login|authentication required/i],
 ['PAGE_LOADING',/still loading|DOM not ready|DOM not stable/i],
 ['MERCHANT_CHECKOUT_ERROR',/Merchant reported Something went wrong/i],
 ['CHECKOUT_READY_TIMEOUT',/Card checkout readiness timed out/i],
 ['CHECKOUT_OPEN_UNRESOLVED',/Checkout opening is unresolved/i],
 ['BASKET_MISMATCH',/Basket.*mismatch|Unexpected basket item count|unrelated or changed items|Basket price/i],
 ['BASKET_NOT_EMPTY',/Existing basket items|Remove.*selection|basket is not.*empty/i],
 ['TAB_UNAVAILABLE',/No tab with id|Read-only page unavailable|Could not establish connection|Receiving end does not exist/i],
 ['PAYMENT_UNRESOLVED',/payment outcome unresolved|no repeat charge|payment requires.*reconciliation|No durable payment/i],
 ['ACTION_BUSY',/already running|Another run is active|Another checkout requires/i],
 ['AUTHORIZATION_INVALID',/authorized|Invalid.*(?:slot|price|settings)|Outside.*window|Date is outside|Time range/i]
];
// Codes, including codes on worker Error objects, are authoritative. Regexes
// only recognize legacy errors that have no known structured classification.
const recoveryModes=Object.freeze({
 MANUAL_CHECK_WHILE_ARMED:'user-action',
 CARD_FILL_REVIEW_REQUIRED:'user-action',
 RECEIPT_CONFLICT:'payment-reconciliation',EXISTING_PURCHASE_READ_ONLY:'user-action',
 UNCLASSIFIED_FAILURE:'manual-review',
 UNRESOLVED_CHECKOUT:'payment-reconciliation',
 PURCHASE_MISSING:'manual-review',PURCHASE_AMBIGUOUS:'manual-review',PURCHASE_LAYOUT_UNKNOWN:'manual-review',
 PURCHASE_STATE_UNSAFE:'payment-reconciliation',REFERENCE_UNAVAILABLE:'manual-review',
 AUTHENTICATION_REQUIRED:'user-action',PAGE_LOADING:'read-only-observation',
 MERCHANT_CHECKOUT_ERROR:'manual-review',CHECKOUT_READY_TIMEOUT:'read-only-observation',CHECKOUT_OPEN_UNRESOLVED:'read-only-observation',
 BASKET_MISMATCH:'manual-review',BASKET_NOT_EMPTY:'user-action',TAB_UNAVAILABLE:'read-only-observation',
 PAYMENT_UNRESOLVED:'payment-reconciliation',ACTION_BUSY:'read-only-observation',AUTHORIZATION_INVALID:'user-action',
 PAGE_TAB_ERROR:'read-only-observation',PAGE_READY_TIMEOUT:'read-only-observation',PAGE_AUTHENTICATION_REQUIRED:'user-action',
 PAGE_UNEXPECTED_ORIGIN:'manual-review',PAGE_BASKET_ROUTE_CHANGED:'manual-review',
 GRID_TAB_ERROR:'read-only-observation',GRID_READY_TIMEOUT:'read-only-observation',GRID_AUTHENTICATION_REQUIRED:'user-action',
 GRID_UNEXPECTED_ORIGIN:'manual-review',GRID_LAYOUT_REJECTED:'manual-review',GRID_ROUTE_CHANGED:'manual-review',GRID_CANDIDATE_CHANGED:'manual-review'
});
export function failureFor(error,{operation,paymentPossible=false}={}){
 const message=typeof error==='string'?error:error?.message||error?.error||'';
 const candidates=[error?.reasonCode,error?.errorCode,error?.code,error?.diagnostic?.errorCode,error?.pageCode,error?.gridCode];
 const supplied=candidates.find(code=>typeof code==='string'&&Object.hasOwn(recoveryModes,code));
 const reasonCode=supplied||rules.find(([,pattern])=>pattern.test(message))?.[0]||'UNCLASSIFIED_FAILURE';
 return {reasonCode,...(operation?{operation}:{}),recovery:{mode:paymentPossible?'payment-reconciliation':recoveryModes[reasonCode],automaticReplayAllowed:false}};
}
