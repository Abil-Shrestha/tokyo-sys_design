import Image from "next/image";
import Card from "../components/card";
export default function Home() {
  const jpn = [
    {
      cn: "font-array bg-gradient-to-b rounded-md from-[#c8d5bb] to [#47585c]",
      text: "Sabi nezu",
    },
    {
      cn: "font-pramukh bg-gradient-to-b rounded-md from-[#80989b] to [#d4dcda]",
      text: "Usuku mo nezu",
    },
    {
      cn: "font-melodrama bg-gradient-to-b rounded-md from-[#4d80e6] to [#e5e4e6]",
      text: "Nezuogusa",
    },
    {
      cn: "font-sligoil bg-gradient-to-b from-[#4d80e6] to [#e5e4e6] ",
      text: "Yanagi nezumi",
    },
  ];
  return (
    <main className=" flex flex-col justify-evenly text-white items-center p-24 text-3xl">
      <h1 className="py-12 text-6xl font-milkman">THE FONTS & GRADIENTS</h1>

      <div className="flex flex-row gap-4 ">
        {jpn.map((item) => {
          return <Card cn={item.cn} text={item.text} />;
        })}
      </div>
      <h1 className="font-geistmono p-2 ">Geistmono Footer</h1>
    </main>
  );
}
