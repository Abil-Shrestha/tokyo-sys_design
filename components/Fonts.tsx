import {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardDescription,
  CardContent,
} from "./Card";
import { FadeIn } from "@/src/components/Fade";

const Fonts = () => {
  const jpn = [
    {
      cn: "font-array",
      text: "Sabi nezu",
    },
    {
      cn: "font-milkman ",
      text: "Usuku mo nezu",
    },
    {
      cn: "font-melodrama ",
      text: "Nezuogusa",
    },
    {
      cn: "font-sligoil",
      text: "Yanagi nezumi ",
    },
  ];
  const grd = [
    {
      cn: "from-[#c8d5bb] to [#47585c]",
      text: "Sabi nezu",
    },
    {
      cn: "font-pramukh ",
      text: "Usuku mo nezu",
    },
    {
      cn: "font-melodrama ",
      text: "Nezuogusa",
    },
    {
      cn: "font-migra",
      text: "Yanagi nezumi ",
    },
  ];
  return (
    <div className="w-full flex flex-col items-center justify-center overflow-hidden rounded-md">
      <FadeIn>
        <h1 className="md:text-4xl text-3xl lg:text-7xl text-center italic font-light font-migra bg-clip-text animate-gradient-x relative z-20 text-white tracking-tighter">
          FONTS & GRADIENTS
        </h1>
      </FadeIn>
      <FadeIn>
        <div className="flex flex-row gap-4 pb-12 ">
          {jpn.map((item, i) => {
            return (
              <Card
                className={`${item.cn} p-4 bg-white/40 backdrop-blur-md text-4xl`}
                key={item.text + i}
              >
                <CardTitle> {item.text}</CardTitle>
                <CardContent className="mt-2"> {item.cn}</CardContent>
              </Card>
            );
          })}
        </div>
      </FadeIn>
      <FadeIn>
        <div className="flex flex-row gap-4 pb-12 ">
          {jpn.map((item, i) => {
            return (
              <Card
                className={`${item.cn} p-4 bg-white/40 backdrop-blur-md text-4xl`}
                key={item.text + i}
              >
                <CardTitle> {item.text}</CardTitle>
                <CardContent className="mt-2"> {item.cn}</CardContent>
              </Card>
            );
          })}
        </div>
      </FadeIn>
    </div>
  );
};

export default Fonts;
