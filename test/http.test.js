import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableTlsIssue } from '../src/http.js';

test('only certificate problems browsers may get past are read anyway', () => {
    assert.equal(readableTlsIssue('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), 'INCOMPLETE_CHAIN');
    assert.equal(readableTlsIssue('UNABLE_TO_GET_ISSUER_CERT_LOCALLY'), 'UNVERIFIED_ISSUER');
    for (const blocked of ['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID', null]) {
        assert.equal(readableTlsIssue(blocked), null);
    }
});
