Explore the frontier of multimodal AI models in your web browser! This extension allows you to easily play around with AI agents that act in web browsers. It can also help you to collect labeled data about actions in webpages (for training ML models).

Give the agent a task like finding something in the bowels of a website or setting up an eCommerce-transaction/service-reservation, and then watch its interactions with the browser or walk away to do something else.

The extension is very customizable. You can choose between ChatGPT, Claude, or Gemini for the agent's brains, with support for more AI providers planned. There are other knobs for controlling costs and tweaking UI behavior.

The extension provides an informative yet compact UI:
- many parts of the UI provide additional information when hovered over.
- when the agent would act on an element, it visually highlights the element first.
- status updates are frequently shown in the side panel on top of updates in an 'Action History' pane when actions are performed. 

Thorough record-keeping allows a curious user to investigate the details of the inputs and outputs of the AI model after it behaved perplexingly in a task, or to share evidence of the AI model's actions with others.

You can also turn on 'monitor mode' and confirm _each_ action before it's taken (or optionally tell the model why you're rejecting a proposed action). That both grants more peace of mind and allows more interactive & in-depth investigation of the AI agent's reasoning abilities (because you can give hints or nudges when it's confused).

When monitor mode is off, the agent still has an experimental 'safety monitor' feature that watches for risky actions and, when it 'thinks' the agent's next action would be risky, it pauses the agent and waits for user confirmation before proceeding. It is customizable (so you can tell it to not bother you about low risk actions) but currently cannot be relied upon to always recognize a dangerous action.

Please be aware that use of this extension is subject to a [privacy policy](https://github.com/OSU-NLP-Group/SeeActChromeExtension/blob/main/documents/privacy_policy.pdf), 
and that you are legally responsible for any consequences if you start an agent on a task in a legally or financially sensitive context (with monitor mode off)
and the agent makes an undesired purchase or does something illegal as a result of misunderstanding your intent.