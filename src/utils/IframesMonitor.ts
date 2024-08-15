import {Logger} from "loglevel";
import {createNamedLogger} from "./shared_logging_setup";
import {renderUnknownValue} from "./misc";

export class IframesMonitor {
    private readonly logger: Logger;
    private intersectionObserver: IntersectionObserver;
    private mutationObserver: MutationObserver;
    private iframePositions: Map<HTMLIFrameElement, DOMRect>;
    private checkInterval: number;
    private documentToMonitor: Document;
    private methodToCallWhenChangeInSetOfVisibleIframes: () => Promise<void>;

    private periodicCheckId: number | NodeJS.Timeout | undefined;

    constructor(docToMonitor: Document, methodToCall: () => Promise<void>, logger?: Logger, checkIntervalMs: number = 1000) {
        this.logger = logger ?? createNamedLogger('iframes-monitor', false);
        if (docToMonitor.body === null) {
            throw new Error('Document must have a body element in order to monitor it for visible iframes');
        }
        this.documentToMonitor = docToMonitor;
        this.methodToCallWhenChangeInSetOfVisibleIframes = methodToCall;
        this.iframePositions = new Map();
        this.checkInterval = checkIntervalMs;

        this.intersectionObserver = new IntersectionObserver(
            this.handleIntersection.bind(this),
            {threshold: 0}
        );

        this.mutationObserver = new MutationObserver(
            this.handleMutation.bind(this)
        );

        this.observeExistingIframes();
        this.observeNewIframes();
        this.startPeriodicCheckForMovement();
    }

    private observeExistingIframes(): void {
        this.documentToMonitor.body.querySelectorAll('iframe').forEach(iframe => {
            this.observeIframe(iframe);
        });
    }

    private observeNewIframes(): void {
        this.mutationObserver.observe(this.documentToMonitor.body, {
            childList: true,
            subtree: true
        });
    }

    private observeIframe(iframe: HTMLIFrameElement): void {
        this.intersectionObserver.observe(iframe);
        //Per MDN docs, the IntersectionObserver will immediately call the callback for this element once after the
        // observe() call, so we don't need to record its initial position (or even check whether it's visible) here
    }

    private handleIntersection(entries: IntersectionObserverEntry[]): void {
        entries.filter(entry => entry.isIntersecting).forEach(entry => {
            const iframe = entry.target as HTMLIFrameElement;
            if (this.iframePositions.has(iframe)) {
                this.checkIframePosition(iframe);
            } else {
                // because of the filter on isIntersecting, we'll only get here if this iframe is visible; because of
                // the if-else, we'll only get here if it's the first time that iframe is visible
                this.iframePositions.set(iframe, iframe.getBoundingClientRect());
                this.logger.trace(`calling method when iframe became visible; iframe: ${iframe.outerHTML.slice(0, 300)}`);
                this.methodToCallWhenChangeInSetOfVisibleIframes().catch((error) => {
                    this.logger.error(`Error calling method when iframe became visible; error: ${renderUnknownValue(error)}; iframe: ${iframe.outerHTML.slice(0, 300)}`);
                });
            }
        });
    }

    private handleMutation(mutations: MutationRecord[]): void {
        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (node instanceof HTMLIFrameElement) {
                    this.observeIframe(node);
                    this.logger.trace(`New iframe detected and now being observed: ${node.outerHTML.slice(0, 300)}`);
                } else if (node instanceof HTMLElement) {
                    node.querySelectorAll('iframe').forEach(iframe => {
                        this.observeIframe(iframe);
                        this.logger.trace(`New iframe detected within added element and now being observed; iframe: ${iframe.outerHTML.slice(0, 300)}; node: ${node.outerHTML.slice(0, 300)}`);
                    });
                }
            });
        });
    }

    private checkIframePosition(iframe: HTMLIFrameElement): void {
        const oldPosition = this.iframePositions.get(iframe);
        const newPosition = iframe.getBoundingClientRect();

        if (oldPosition &&
            (oldPosition.left !== newPosition.left || oldPosition.top !== newPosition.top)) {
            this.logger.trace(`calling method when iframe position changed; iframe: ${iframe.outerHTML.slice(0, 300)}; prior position: (${oldPosition.x}, ${oldPosition.y}); new position: (${newPosition.x}, ${newPosition.y})`)
            this.methodToCallWhenChangeInSetOfVisibleIframes().catch(
                (error) => {this.logger.error(`Error calling method when iframe position changed; error: ${renderUnknownValue(error)}; iframe: ${iframe.outerHTML.slice(0, 300)}; prior position: (${oldPosition.x}, ${oldPosition.y}); new position: (${newPosition.x}, ${newPosition.y})`);});
        }

        this.iframePositions.set(iframe, newPosition);
    }

    private startPeriodicCheckForMovement(): void {
        this.periodicCheckId = setInterval(() => {
            const iframePositionsCheckStart = performance.now();
            const iframePositionsToCheck = new Map(this.iframePositions);
            //must do shallow copy of data structure because otherwise we'd be iterating over a data structure that
            // could be modified by observer callbacks partway through the iteration
            iframePositionsToCheck.forEach(
                (_, iframe) => {this.checkIframePosition(iframe);});
            const positionCheckDuration = performance.now() - iframePositionsCheckStart;
            if (positionCheckDuration > 100) {this.logger.warn(`Iframe positions check took ${positionCheckDuration}ms`);}
        }, this.checkInterval);
    }

    public disconnect(): void {
        this.intersectionObserver.disconnect();
        this.mutationObserver.disconnect();
        clearInterval(this.periodicCheckId);
    }
}