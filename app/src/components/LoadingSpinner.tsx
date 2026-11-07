// Copyright (c) Sui Potatoes
// SPDX-License-Identifier: MIT

/**
 * Loading, without words: a quiet grey ring at the centre of the window. It
 * fades in after a beat, so loads that finish quickly never show it at all.
 */
export function LoadingSpinner() {
    return (
        <div className="loading-spinner" role="status" aria-label="Loading">
            <span />
        </div>
    );
}
