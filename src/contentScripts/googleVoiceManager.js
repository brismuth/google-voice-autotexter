/**
 * Gets a random time in ms between min and max
 * @return {Number}
 */
function getRandomWaitTime2(min, max) {
	return Math.floor(Math.random() * (max-min)) + min;
}
/**
 * Pattern 1 for sending messages: send message at some time between 1 s - 20 s.
 */
function delayPatternFn1(){
	const t1 = 1*1000;
	const t2 = 20*1000;
	return function(){
		return getRandomWaitTime2(t1, t2);
	}
}
/**
 * Pattern 2 for sending messages: send message randomly each 200 ms - 2 s. Pause for 1 minutes after 20 messages.
 */
function delayPatternFn2(){
	var counter = 0;
	const groupSize = 20;
	const shortDelay = 2*1000; //2 s
	const longDelay = 1*60*1000; //1 min
	
	return function(){
		if (counter <= groupSize) return (counter++, getRandomWaitTime2(200, shortDelay));
		return (counter = 0, longDelay);
	}
}
const patterns = {
	0: function() { return () => getRandomWaitTimeMS(6000) },
	1: delayPatternFn1,
	2: delayPatternFn2,
}
/**
 * This runs on voice.google.com
 */
class GoogleVoiceSiteManager {
	constructor() {
		this.messagesToSend = {};
		this.numberQueue = [];
		this.currentNumberSending = '';
		this.delayPattern = null;
	}

	initialize() {
		var that = this;
		
		chrome.runtime.onMessage.addListener(function (message, sender, response) {
			if (message.from === 'popup' && message.type === 'SEND_MESSAGES') {
				that.addMessagesToQueue(message.messages);
				
				//get sending pattern
				that.delayPattern = patterns[message.messages.delayer || 0]();
				
				//switch To Text View
				document.querySelector(selectors.gvMessagesTab).click();

				that.sendFromQueue();
			}

			if (message.from === 'popup' && message.type === 'CHECK_GOOGLE_VOICE_SUPPORT') {
				var url = window.location.href;
				response(url.startsWith('https://voice.google.com/') ? 'GV' : false);
			}
		});
	}

	addMessagesToQueue(messages) {
		Object.assign(this.messagesToSend, messages.messages);
		this.numberQueue = this.numberQueue.concat(messages.queue);
	}

	async sendFromQueue() {
		let retryCount = 5;
		let verifyOnly = false;

		if (this.numberQueue.length > 0) {
			this.currentNumberSending = this.numberQueue.shift();

			let sendExecutionQueue = this.getSendExecutionQueue();
			while (sendExecutionQueue.length) {
				let currentStep = sendExecutionQueue.shift().bind(this);
				const result = await keepTryingAsPromised(currentStep, retryCount > 0);
				if (!result) {
					console.log(`Bulk SMS - Step failed (${getFunctionName(currentStep)}), retrying message.`);
					retryCount--; // if this keeps happening, alert on it

					if (verifyOnly) {
						sendExecutionQueue = this.getVerificationOnlyExecutionQueue();
					} else {
						// otherwise start over in the execution queue
						sendExecutionQueue = this.getSendExecutionQueue();
					}
				}
				if (getFunctionName(currentStep) === 'sendMessage') {
					verifyOnly = true; // we don't want to risk sending a message twice
				}
			}
		}
	}

	getSendExecutionQueue() {
		return [
			this.showNumberInput,
			this.fillNumberInput,
			this.startChat,
			this.confirmChatSwitched,
			this.writeMessage,
			this.sendMessage,
			this.confirmThreadHeaderUpdated,
			this.confirmSent
		];
	}

	// opens up the chat again and checks if the message was sent previously
	getVerificationOnlyExecutionQueue() {
		return [
			this.showNumberInput,
			this.fillNumberInput,
			this.startChat,
			this.confirmChatSwitched,
			this.confirmSent
		];
	}

	showNumberInput() {
		var showInputButton = document.querySelector(selectors.gvNumInputButton);
		if (showInputButton && showInputButton.offsetParent !== null) {
			showInputButton.click();
			return true;
		}
	}

	fillNumberInput() {
		let numInput = document.querySelector(selectors.gvNumInput);
		if (numInput && numInput.offsetParent !== null) {
			numInput.value = this.currentNumberSending;

			// this fires the necessary events for Google Voice to pick up
			numInput.focus();
			numInput.select();
			document.execCommand('cut');
			document.execCommand('paste');

			// confirm that the number was added as expected
			let numInputConfirm = document.querySelector(selectors.gvNumInput);
			return numInputConfirm && numInputConfirm.value === this.currentNumberSending;
		}
	}

	// clicks the "start SMS" button on the number dropdown
	startChat() {
		var startChatButton = document.querySelector(selectors.gvStartChatButton);
		if (startChatButton && startChatButton.offsetParent !== null) {
			startChatButton.click();
			return true;
		}
	}

	confirmChatSwitched() {
		const numberToSend = this.currentNumberSending;
		const recipientButton = document.querySelector(selectors.gvRecipientButton);
		if (recipientButton && recipientButton.offsetParent !== null) {
			var number = formatNumber(recipientButton.innerText);
			return numberToSend === number;
		}
	}

	writeMessage() {
		const number = this.currentNumberSending;
		if (!this.messagesToSend[number]) {
			return false;
		}

		const message = this.messagesToSend[number];

		var messageEditor = document.querySelector(selectors.gvMessageEditor);

		if (messageEditor.value && messageEditor.value !== message) {
			console.log('Bulk SMS - Already had value:', messageEditor.value);
			return;
		}

		if (messageEditor && messageEditor.offsetParent !== null) {
			messageEditor.value = message;
			return true;
		}
	}

	sendMessage() {
		var messageEditor = document.querySelector(selectors.gvMessageEditor);
		if (!messageEditor) {
			return;
		}

		messageEditor.focus();
		messageEditor.select();
		document.execCommand('cut');
		document.execCommand('paste');

		// click send button
		let sendButtonOld = document.querySelector(selectors.gvSendButtonOld);
		let sendButtonNew = document.querySelector(selectors.gvSendButtonNew);
		if (sendButtonOld && sendButtonOld.offsetParent !== null && sendButtonOld.getAttribute('aria-disabled') === 'false') {
			sendButtonOld.click();
			return true;
		}
		if (sendButtonNew && sendButtonNew.offsetParent !== null && sendButtonNew.disabled === false) {
			sendButtonNew.dispatchEvent(new Event('mousedown'));
			sendButtonNew.dispatchEvent(new Event('mouseup'));
			return true;
		}
	}

	confirmThreadHeaderUpdated() {
		let chatLoadedHeader = document.querySelector(selectors.gvChatLoadedHeader); // the header switches to this after sending is complete. If we move on before this, it can break things.
		if (chatLoadedHeader) {
			return true;
		}
	}

	confirmSent() {
		let sendingNote = document.querySelector(selectors.gvSendingNote); // this is the note that says "Sending", it will disappear when it is finished

		if (!sendingNote) {
			// check if the message we sent is showing up in the chat window
			let mostRecentMessages = document.querySelectorAll(selectors.gvMostRecentMessages);
			let	sentMessageIsThreaded = false;
			if (mostRecentMessages && mostRecentMessages.length) {
				var i = mostRecentMessages.length - 1;
				for (i; !sentMessageIsThreaded && i >= 0; i--) {
					let mostRecentMessage = mostRecentMessages[mostRecentMessages.length - 1];
					sentMessageIsThreaded = mostRecentMessage.innerText === this.messagesToSend[this.currentNumberSending];
				}
			}

			if (sentMessageIsThreaded) {
				// continue with queue
				const timeBeforeNextMessage = this.delayPattern();
				setTimeout(this.sendFromQueue.bind(this), timeBeforeNextMessage);
				return true;
			}
		}
	}
}
