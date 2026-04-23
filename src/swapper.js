import { ethers } from "ethers";

export class BaseSwapper {
    constructor(provider, wallet) {
        this.provider = provider;
        this.wallet = wallet;
    }

    async getRelayQuote(params) {
        const response = await fetch("https://api.relay.link/quote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user: this.wallet.address,
                originChainId: 8453, // Base
                destinationChainId: 8453, // Base
                originCurrency: params.tokenIn === "native" ? "0x0000000000000000000000000000000000000000" : params.tokenIn,
                destinationCurrency: params.tokenOut === "native" ? "0x0000000000000000000000000000000000000000" : params.tokenOut,
                amount: params.amountIn.toString(),
                tradeType: "EXACT_INPUT"
            })
        });

        const data = await response.json();
        if (data.error || !data.steps) throw new Error(data.message || "Gagal mengambil quote dari Relay");
        return data;
    }

    async swap(params) {
        const quote = await this.getRelayQuote(params);

        // Relay memberikan langkah-langkah (steps) yang harus dilakukan
        for (const step of quote.steps) {
            for (const item of step.items) {
                const tx = {
                    to: item.to,
                    data: item.data,
                    value: item.value ? ethers.getBigInt(item.value) : 0n,
                    gasLimit: 300000 // Estimasi aman untuk Relay
                };

                const response = await this.wallet.sendTransaction(tx);
                await response.wait();
                return { tx: response };
            }
        }
    }

    async getTokenInfo(address) {
        if (address === "native") {
            const balance = await this.provider.getBalance(this.wallet.address);
            return { symbol: "ETH", decimals: 18, balance };
        }
        const abi = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"];
        const contract = new ethers.Contract(address, abi, this.provider);
        const [balance, decimals, symbol] = await Promise.all([
            contract.balanceOf(this.wallet.address),
            contract.decimals(),
            contract.symbol()
        ]);
        return { balance, decimals, symbol };
    }
}
