// Owlbear loads this module for the lifetime of the extension, independently of
// the Dicebox action popover. The request/history service is initialized only
// after OBR_READY; the standalone Dicebox build never ships this entry point.
import OBR from './obr-sdk.js';
import { initializeOwlbearBackground } from './owlbear-session.js';

OBR.onReady(() => {
  initializeOwlbearBackground(OBR).catch(error => {
    console.error('[Dicebox/Owlbear background] initialization failed', error);
  });
});
