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
                tradeType: "EXACT_INPUT",
                useExternalLiquidity: true, // Mencari rute lebih luas (Uniswap, Aerodrome, dll)
                referrer: "relay.link/swap" // Opsional: membantu rute agar lebih stabil
            })
        });

        const data = await response.json();
        
        // Eror handling yang lebih detail
        if (data.error || !data.steps) {
            const errorMsg = data.message || "Gagal mengambil quote dari Relay";
            if (errorMsg.includes("no routes found")) {
                throw new Error("Tidak ada rute ditemukan. Coba naikkan sedikit jumlah (amount) di .env kamu.");
            }
            throw new Error(errorMsg);
        }
        return data;
    }

    async swap(params) {
        const quote = await this.getRelayQuote(params);

        // Relay memberikan langkah-langkah (steps) yang harus dilakukan
        for (const step of quote.steps) {
            for (const item of step.items) {
                // Gunakan estimasi gas dari Relay jika tersedia, jika tidak pakai fallback 350.000
                const tx = {
                    to: item.to,
                    data: item.data,
                    value: item.value ? ethers.getBigInt(item.value) : 0n,
                    gasLimit: item.gasLimit ? ethers.getBigInt(item.gasLimit) : 350000n 
                };

                const response = await this.wallet.sendTransaction(tx);
                console.log(`   🔗 Menunggu konfirmasi: ${response.hash}`);
                await response.wait();
                return { tx: response };
            }
        }
    }

    async getTokenInfo(address) {
        if (address === "native" || address === "0x0000000000000000000000000000000000000000") {
            const balance = await this.provider.getBalance(this.wallet.address);
            return { symbol: "ETH", decimals: 18, balance };
        }
        const abi = [
            "function balanceOf(address) view returns (uint256)", 
            "function decimals() view returns (uint8)", 
            "function symbol() view returns (string)"
        ];
        const contract = new ethers.Contract(address, abi, this.provider);
        const [balance, decimals, symbol] = await Promise.all([
            contract.balanceOf(this.wallet.address),
            contract.decimals(),
            contract.symbol()
        ]);
        return { balance, decimals, symbol };
    }
}
