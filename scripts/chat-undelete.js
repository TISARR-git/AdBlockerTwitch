// Chat Undelete - Show deleted messages using Twitch's aria-labels
// Part of Twitch AdBlocker extension
(function () {
    'use strict';

    console.log('[ChatUndelete] Extension script initialized v2.0 (Aria-Label strategy)');

    // CSS for deleted messages indicator
    const style = document.createElement('style');
    style.textContent = `
        .chat-undelete-restored {
            text-decoration: line-through !important;
            opacity: 0.6 !important;
            color: #adadb8 !important;
            font-style: italic;
        }
    `;
    document.head.appendChild(style);

    // Process a message to check if it's deleted and restore it
    function handlePotentiallyDeletedMessage(messageNode) {
        // Fast exit if not an element node
        if (messageNode.nodeType !== Node.ELEMENT_NODE) return;

        // Determine if this is the placeholder span itself, or if we are passed the parent container
        const placeholder = messageNode.classList?.contains('chat-line__message--deleted-notice')
            ? messageNode
            : messageNode.querySelector('.chat-line__message--deleted-notice, [data-test-selector="chat-deleted-message-placeholder"]');

        if (!placeholder) return;

        // Skip if we've already restored it
        if (placeholder.classList.contains('chat-undelete-restored')) return;

        // Ascend to the parent container that holds the attributes
        const parentLine = placeholder.closest('.chat-line__message, [data-a-target="chat-line-message"]');
        if (!parentLine) return;

        // Twitch accessibility standard: The parent container retains aria-label="Username: Message content"
        let ariaLabel = parentLine.getAttribute('aria-label');
        let username = parentLine.getAttribute('data-a-user') || '';

        if (ariaLabel) {
            // "Username : The message" or "Username: The message"
            // We need to strip the username prefix
            let messageText = ariaLabel;

            // Try explicit removal based on the data-a-user attribute
            if (username && messageText.toLowerCase().startsWith(username.toLowerCase())) {
                // Remove username and any succeeding colon/spaces
                messageText = messageText.substring(username.length).replace(/^[\s:]+/, '');
            } else {
                // Fallback: Split by colon if it's a generic format
                const parts = messageText.split(':');
                if (parts.length > 1) {
                    parts.shift(); // Remove the presumed username part
                    messageText = parts.join(':').trim();
                }
            }

            // Restore the text
            if (messageText && messageText.length > 0) {
                console.log(`[ChatUndelete] Restored message from ${username}`);
                placeholder.textContent = messageText;
                placeholder.classList.add('chat-undelete-restored');
            }
        }
    }

    // Process mutations for new or modified chat elements
    function processMutation(mutations) {
        for (const mutation of mutations) {
            // When Twitch deletes a message, it adds the placeholder span to the DOM (childList)
            if (mutation.type === 'childList') {
                for (const node of mutation.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        // Check if the added node itself is the placeholder
                        if (node.classList?.contains('chat-line__message--deleted-notice') || node.hasAttribute?.('data-test-selector')) {
                            handlePotentiallyDeletedMessage(node);
                        } else if (node.classList?.contains('chat-line__message-container') || node.classList?.contains('chat-line__message')) {
                            // Check if the placeholder was added inside this new container
                            handlePotentiallyDeletedMessage(node);
                        }
                    }
                }
            }
            // Also check if they modified attributes of a chat line
            else if (mutation.type === 'attributes') {
                if (mutation.target.classList?.contains('chat-line__message')) {
                    handlePotentiallyDeletedMessage(mutation.target);
                }
            }
        }
    }

    // Initialize observer
    function initObserver() {
        const chatContainer = document.querySelector('.chat-scrollable-area__message-container');
        if (!chatContainer) {
            // Chat might not be loaded yet, retry
            setTimeout(initObserver, 1000);
            return;
        }

        console.log('[ChatUndelete] Attached MutationObserver to chat container.');

        const observer = new MutationObserver(processMutation);
        observer.observe(chatContainer, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // Scan initial elements just in case
        chatContainer.querySelectorAll('.chat-line__message').forEach(handlePotentiallyDeletedMessage);
    }

    // Wait for page to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initObserver, 2000));
    } else {
        setTimeout(initObserver, 2000);
    }
})();
